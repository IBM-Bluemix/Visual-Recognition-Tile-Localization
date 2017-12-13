/*eslint-env node*/

//------------------------------------------------------------------------------
// node.js starter application for Bluemix
//------------------------------------------------------------------------------

// This application uses express as its web server
// for more info, see: http://expressjs.com
var express = require('express');
var fs = require('fs');
var fileUpload = require('express-fileupload');
var uuid = require('node-uuid');
var gm = require('gm').subClass({
    imageMagick: true
});
var request = require('request');
var async = require("async");
var spawn = require('child_process').spawn;

var VisualRecognitionV3 = require('watson-developer-cloud/visual-recognition/v3');


var totalAnalysisRequests = 0;
var completeAnalysisRequests = 0;

var rootDir = './uploads';
var MIN_TILE_SIZE = 64;

// PUT YOUR WATSON KEY AND CLASSIFIER ID HERE:
var WATSON_KEY = "589511cb2a31e3379cda2a13b59ee9ff21e93455";
var WATSON_CLASSIFIER = "ParkingSpaceDetector1_1254136001"; //"ParkingLot_1593156007";PKLot2_652205709


var visual_recognition = new VisualRecognitionV3({
    api_key: WATSON_KEY,
    version_date: '2016-05-19'
});

// cfenv provides access to your Cloud Foundry environment
// for more info, see: https://www.npmjs.com/package/cfenv
var cfenv = require('cfenv');

// create a new express server
var app = express();

//setting up socket.io for realtime communication
var http = require('http').Server(app);
var io = require('socket.io')(http);

app.use(fileUpload());

// serve the files out of ./public as our main files
app.use(express.static(__dirname + '/public'));
app.use('/uploads', express.static(rootDir));

// get the app environment from Cloud Foundry
var appEnv = cfenv.getAppEnv();

app.post('/file-upload', function(req, res) {
    var sampleFile;
    var id = uuid.v4();
    var sessionId = req.body.sessionId;
    completeAnalysisRequests = 0;

    if (!req.files) {
        res.send('No files were uploaded.');
        return;
    }

    var uploadDir = rootDir + "/" + id;
    var imagePath = uploadDir + "/image.jpg";
    var jsonPath = uploadDir + "/image.json";

    if (!fs.existsSync(rootDir)) {
        fs.mkdirSync(rootDir);
    }

    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir);
    }

    var tileWidth = req.body.tileWidth ? req.body.tileWidth : MIN_TILE_SIZE;
    var tileHeight = req.body.tileHeight ? req.body.tileHeight : MIN_TILE_SIZE;

    if (tileWidth < MIN_TILE_SIZE) {
        tileWidth = MIN_TILE_SIZE
    }
    if (tileHeight < MIN_TILE_SIZE) {
        tileHeight = MIN_TILE_SIZE
    }


    sampleFile = req.files.file;
    sampleFile.mv(imagePath, function(err) {
        if (err) {
            res.status(500).send(err);
        } else {
            res.send('File uploaded!');
            update(sessionId, "file uploaded and saved to " + imagePath)
            generateImageTiles(sessionId, {
                rootDir: rootDir,
                id: id,
                imagePath: imagePath,
                imageDir: uploadDir,
                tileWidth: tileWidth,
                tileHeight: tileHeight
            }, function(err, imageData) {
                if (err) {
                    update(sessionId, "parsing error: " + err.toString())
                } else {
                    update(sessionId, "parsing complete")
                    var imageData = imageData;
                    imageData.imagePath = imagePath;
                    processImages(sessionId, imageData, function(updatedImageData) {
                        update(sessionId, "analysis complete")


                        var json = JSON.stringify(updatedImageData);

                        fs.writeFile(jsonPath, json, function(err) {
                            if (err) return update(sessionId, err);
                            update(sessionId, 'wrote json data');

                            var result = {
                                imagePath: imagePath,
                                jsonPath: jsonPath
                            }
                            dispatch(sessionId, "processingComplete", JSON.stringify(result))
                        });

                    })
                }
            })
        }
    });
});






function generateImageTiles(sessionId, options, callback) {

    var imageSize = {};
    var parseData = {};

    //var fileName = parseFileName(options.imagePath);
    var tilesDir = options.imagePath + "_tiles";
    var tileWidth = options.tileWidth;
    var tileHeight = options.tileHeight;

    if (!fs.existsSync(tilesDir)) {
        fs.mkdirSync(tilesDir);
    }

    var image = gm(options.imagePath)
        .size(function(err, size) {

            if (err) {
                callback(err);
                return;
            }


            imageSize = size;

            var cols = Math.ceil(imageSize.width / tileWidth);
            var rows = Math.ceil(imageSize.height / tileHeight);

            parseData.imageWidth = size.width;
            parseData.imageHeight = size.height;
            parseData.dimensions = {
                cols: cols,
                rows: rows
            }

            parseData.tiles = [];

            var command = 'convert ' + options.imagePath + ' -crop ' + tileWidth + 'x' + tileHeight + ' -set filename:tile "%[fx:page.x]_%[fx:page.y]" +repage +adjoin "' + tilesDir + '/tile_%[filename:tile].jpg"';
            update(sessionId, "Invoke: " + command);


            var childProcess = spawn("convert", [
                options.imagePath,
                "-crop", tileWidth + 'x' + tileHeight,
                "-set", "filename:tile", "%[fx:page.x]_%[fx:page.y]",
                "+repage",
                "+adjoin", tilesDir + "/tile_%[filename:tile].jpg"
            ]);

            var childProcessError = undefined;

            childProcess.stdout.on('data', function(data) {
                update(sessionId, `stdout: ${data}`);
            });

            childProcess.stderr.on('data', function(data) {
                update(sessionId, `stderr: ${data}`);
            });

            childProcess.on('error', function(err) {
                update(sessionId, `ERROR: ${err.toString()}`);
                childProcessError = err;
            });

            childProcess.on('close', function(code) {
                update(sessionId, `child process exited with code ${code}`);
                //realtime.emit(`child process exited with code ${code}`);

                if (code == 0) {
                    for (var r = 0; r < rows; r++) {
                        //for (var c=0; c<cols; c++) {

                        if (parseData.tiles[r] == undefined) {
                            parseData.tiles[r] = [];
                        }

                        //loop over columns
                        for (var c = 0; c < cols; c++) {

                            if (parseData.tiles[r][c] == undefined) {
                                parseData.tiles[r][c] = {};
                            }

                            var x = c * tileWidth;
                            var y = r * tileHeight;
                            var output = tilesDir + "/tile_" + x + "_" + y + ".jpg";

                            parseData.tiles[r][c].path = output;
                            parseData.tiles[r][c].size = {
                                width: Math.min(tileWidth, parseData.imageWidth - x),
                                height: Math.min(tileHeight, parseData.imageHeight - y)
                            }
                        }
                    }
                }

                callback(childProcessError, parseData);
            });

        });



}





function processImages(sessionId, imageData, callback) {
    update(sessionId, "performing analysis on images...")

    totalAnalysisRequests = 0;
    completeAnalysisRequests = 0;
    var requests = [];

    //loop over cols
    for (var r = 0; r < imageData.tiles.length; r++) {

        //loop over rows
        for (var c = 0; c < imageData.tiles[r].length; c++) {

            var image = imageData.tiles[r][c];

            requests.push(analyzeImage(sessionId, image));

        }
    }



    async.parallelLimit(requests, 8, function() {
        totalAnalysisRequests++;
        callback(imageData);
    })

}









function analyzeImage(sessionId, _image) {
    totalAnalysisRequests++;
    return function(analyze_callback) {


        var fileName = _image.path;
        var analysis = {}

        update(sessionId, "analyzing image: " + fileName);



        var params = {
            images_file: fs.createReadStream(fileName),
            classifier_ids: [WATSON_CLASSIFIER],
            threshold: 0.0
        };

        visual_recognition.classify(params, function(err, res) {
            completeAnalysisRequests++;
            if (err) {
                update(sessionId, "Image Classifier: " + fileName + ": " + JSON.stringify(err));
                analysis = {
                    error: err
                }
            } else {
                update(sessionId, "Classified: " + completeAnalysisRequests + " of " + totalAnalysisRequests)
                analysis = res;
            }

            _image.analysis = analysis;
            analyze_callback();
        });



    }
}













io.on('connection', function(socket) {
    appSocket = socket
    console.log('a user connected');

    socket.on('disconnect', function() {
        console.log('user disconnected');
    });



    socket.on('upgrade', function(room) {
        console.log('upgrade event received for room/id: ' + room);
        socket.join(room);
        socketMap[room] = socket;
    });

});


var socketMap = {};

function update(id, data) {
    //console.log(data)
    if (id && socketMap[id]) {
        socketMap[id].emit("update", data)
    }
}

function dispatch(id, event, data) {
    //console.log(data)
    if (id && socketMap[id]) {
        socketMap[id].emit(event, data)
    }
}





// start the server
http.listen(appEnv.port, function() {
    // print a message when the server starts listening
    console.log("server starting on " + appEnv.url);
});



require("cf-deployment-tracker-client").track();
