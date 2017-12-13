var id = new Date().getTime();
var scaleSlider = undefined;

var emptySpaces = 0;
var fullSpaces = 0;

Dropzone.options.uploader = {
    createImageThumbnails: false,
    acceptedFiles: "image/jpeg,image/jpg",
    uploadMultiple: false,
    sending: function(file, xhr, formData) {
        console.log("sending")
        formData.append('sessionId', id);
    },
    drop: function(event) {
        this.removeAllFiles();
        resetView();
    }
}


var io = io();
io.on('connect', function() {
    console.log("socket connect")

    io.emit('upgrade', id);
});


io.on('disconnect', function() {
    console.log('socket disconnect');
});


io.on('update', function(data) {
    var feedback = $("#feedback");
    var innerHTML = feedback.html();
    innerHTML += "<br/>" + data.toString();
    feedback.html(innerHTML);

    feedback.scrollTop(feedback.prop("scrollHeight"));
});

io.on("processingComplete", function(data) {
    console.log("processing complete");
    renderResult(data);
});

$(document).ready(function() {
    $("#sessionId").val(id);

    scaleSlider = $("#scaleSlider").bootstrapSlider();
    scaleSlider.bootstrapSlider()
    scaleSlider.on("change", function(event) {
        setContentScale(event.value.newValue);
    })

    $("#overlayToggle").change(function(event) {
        var checked = $(this).prop('checked')

        $("#render table").css('visibility', checked ? 'visible' : 'hidden');
    });

})




function debug() {
    renderResult('{"imagePath":"./uploads/78fc1447-fb7c-4096-bd1c-bd094368d289/image.jpg","jsonPath":"./uploads/e8d08f8b-c129-4bf0-9bd1-9d9e1bb3241b/image.json"}')
}

function resetView() {
    $("#render").empty();
    $("#feedback").html("");
}

function setContentScale(targetScale) {

    $("#render").css("transform", "scale(" + targetScale + ")")
    scaleSlider.bootstrapSlider('setValue', targetScale);
}

function renderResult(dataStr) {
    var data = JSON.parse(dataStr)
        //console.log(data)

    var renderContainer = $("#render");

    renderContainer.append($("<img class='' src='" + data.imagePath + "'  />"));
    //renderContainer.append($("<div>" + emptySpaces + "</div>"));

    $.ajax({
            type: 'GET',
            url: data.jsonPath
        })
        .done(function(result) {
            //console.log(result)
            var table = constructTable(result);
            renderContainer.append(table);

            $("#overlayToggle").bootstrapToggle('on');

            $("#legend").removeClass("hidden");
            $("#render-parent").removeClass("hidden");
            $("#footerControls").removeClass("hidden");
            $("#content").addClass("hidden");


            var targetScale = $("#render-parent").width() / result.imageWidth
            setContentScale(targetScale);
        })
        .fail(function(jqXHR, status) {
            console.log("Request failed: " + status);
        });
}

function constructTable(data) {
    var table = $("<table>");
    table.css("width", data.imageWidth);
    table.css("height", data.imageHeight);

    var rows = data.tiles
    for (var r = 0; r < rows.length; r++) {
        var cols = data.tiles[r]
        var row = $("<tr>");

        for (var c = 0; c < cols.length; c++) {
            var cell = $("<td>");
            var cellData = cols[c];
            cell.css("width", cellData.size.width);
            cell.css("height", cellData.size.height);
            var style = getAnalysis(cellData);

            cell.css("background", style)

            cell.html(getConfidence(cellData));
            row.append(cell);
        }

        table.append(row);
    }

    return table;
}

function getAnalysis(cellData) {
    if (cellData.analysis && cellData.analysis.images && cellData.analysis.images.length > 0) {
        var image = cellData.analysis.images[0];
        if (image && image.classifiers && image.classifiers.length > 0) {
            var classifier = cellData.analysis.images[0].classifiers[0]

            if (classifier && classifier.classes && classifier.classes.length > 0) {

                // this demo only visualizes the first classification within the first classifier
                // however could be modified to support multiple classifiers

                var classification = classifier.classes[0];
                return "rgba(255,0,0," + Math.min(classification.score * 2, 0.9) + ")"
            }
        }
    }
    return "rgba(0,0,0,0)"
}

function getConfidence(cellData) {
    if (cellData.analysis && cellData.analysis.images && cellData.analysis.images.length > 0) {
        var image = cellData.analysis.images[0];
        if (image && image.classifiers && image.classifiers.length > 0) {
            var classifier = cellData.analysis.images[0].classifiers[0]

            if (classifier && classifier.classes && classifier.classes.length > 0) {

                // this demo only visualizes the first classification within the first classifier
                // however could be modified to support multiple classifiers

                var classification = classifier.classes[0];

                if (classification.score > 0.4) {
                  //console.log(counter + 1);
                  emptySpaces++;
                } else {
                  fullSpaces++;
                }

                console.log("full: " + fullSpaces);
                console.log("empty: " + emptySpaces);

                return classification.score.toFixed(3)
            }
        }
    }
    return "-"
}
