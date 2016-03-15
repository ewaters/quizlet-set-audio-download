// ==UserScript==
// @name         New Userscript
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        https://quizlet.com/*/*
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/async/1.5.2/async.min.js
// ==/UserScript==
/* jshint -W097 */
/* global AudioContext, setPage, async, $ */
'use strict';

var context = new AudioContext();

window.exportMP3 = function () {
    async.mapSeries(setPage.terms.slice(0, 5), fetchTermAudio, fetchComplete);
}

function fetchComplete(err, terms) {
    if (err) {
        console.error(err);
        return;
    }
    var sampleRate = terms[0].buffers.word.sampleRate;

    var plan = [];
    $.each(terms, function(idx, term) {
        plan.push({ buf: term.buffers.definition });
        plan.push({ silence: 1.0 });
        
        plan.push({ buf: term.buffers.word });
        plan.push({ silence: 1.5 });
        plan.push({ buf: term.buffers.word });
        plan.push({ silence: 2.0 });
    });
    console.log(plan);

    var totalLength = 0;
    $.each(plan, function(idx, item) {
        if (item.silence !== undefined) {
            totalLength += Math.floor(item.silence * sampleRate);
        }
        if (item.buf !== undefined) {
            plan[idx].offset = totalLength;
            totalLength += item.buf.length;
        }
    });
    console.log(plan);

    var buf = context.createBuffer(1, totalLength, sampleRate);
    var channel = buf.getChannelData(0);
    $.each(plan, function(idx, item) {
        if (item.buf === undefined) {
            return;
        }
        channel.set(item.buf.getChannelData(0), item.offset);
    });

    window.playBuf = function() {
        playBuffer(buf);
    };
    window.downloadWAV = function() {
        var wav = audioBufferToWav(buf);
        var blob = new window.Blob([ new DataView(wav) ], {
            type: 'audio/wav'
        });

        var url = window.URL.createObjectURL(blob);
        var anchor = document.createElement('a');
        document.body.appendChild(anchor);
        anchor.style = 'display: none';
        anchor.href = url;
        anchor.download = 'audio.wav';
        anchor.click();
        window.URL.revokeObjectURL(url);
    };
}

function fetchTermAudio(term, cb) {
    term.buffers = {};
    var forEach = function (type, cb) {
        fetchAudio(term.getAudioUrl(type), function (err, buffer) {
            if (err) {
                return cb(err);
            }
            term.buffers[type] = buffer;
            return cb();
        });
    };
    async.each(["word", "definition"], forEach, function(err) { cb(err, term); });
}

function playBuffer (buf) {
    var source = context.createBufferSource();
    source.buffer = buf;
    source.connect(context.destination);
    source.start(0);
}

function appendBuffer (buffer1, buffer2) {
    var numberOfChannels = Math.min(buffer1.numberOfChannels, buffer2.numberOfChannels);
    var tmp = context.createBuffer(numberOfChannels, (buffer1.length + buffer2.length), buffer1.sampleRate);
    for (var i=0; i<numberOfChannels; i++) {
        var channel = tmp.getChannelData(i);
        channel.set(buffer1.getChannelData(i), 0);
        channel.set(buffer2.getChannelData(i), buffer1.length);
    }
    return tmp;
}

function fetchAudio (url, cb) {
    var request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.responseType = 'arraybuffer';
    request.onload = function () {
        context.decodeAudioData(request.response, function (buffer) {
            cb(null, buffer);
        }, function () {
            cb("Audio " + url + " decodeAudioData failed");
        });
    };
    request.send();
}

/* https://github.com/Jam3/audiobuffer-to-wav/blob/master/index.js */
function audioBufferToWav (buffer, opt) {
    opt = opt || {};

    var numChannels = buffer.numberOfChannels;
    var sampleRate = buffer.sampleRate;
    var format = opt.float32 ? 3 : 1;
    var bitDepth = format === 3 ? 32 : 16;

    var result;
    if (numChannels === 2) {
        result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
    } else {
        result = buffer.getChannelData(0);
    }

    return encodeWAV(result, format, sampleRate, numChannels, bitDepth);
}

function encodeWAV (samples, format, sampleRate, numChannels, bitDepth) {
    var bytesPerSample = bitDepth / 8;
    var blockAlign = numChannels * bytesPerSample;

    var buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    var view = new DataView(buffer);

    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    /* RIFF chunk length */
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    /* RIFF type */
    writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, format, true);
    /* channel count */
    view.setUint16(22, numChannels, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * blockAlign, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, blockAlign, true);
    /* bits per sample */
    view.setUint16(34, bitDepth, true);
    /* data chunk identifier */
    writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.length * bytesPerSample, true);
    if (format === 1) { // Raw PCM
        floatTo16BitPCM(view, 44, samples);
    } else {
        writeFloat32(view, 44, samples);
    }

    return buffer;
}

function interleave (inputL, inputR) {
    var length = inputL.length + inputR.length;
    var result = new Float32Array(length);

    var index = 0;
    var inputIndex = 0;

    while (index < length) {
        result[index++] = inputL[inputIndex];
        result[index++] = inputR[inputIndex];
        inputIndex++;
    }
    return result;
}

function writeFloat32 (output, offset, input) {
    for (var i = 0; i < input.length; i++, offset += 4) {
        output.setFloat32(offset, input[i], true);
    }
}

function floatTo16BitPCM (output, offset, input) {
    for (var i = 0; i < input.length; i++, offset += 2) {
        var s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
}

function writeString (view, offset, string) {
    for (var i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

console.log("Eric was here");