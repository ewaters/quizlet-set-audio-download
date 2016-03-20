// ==UserScript==
// @name         Quizlet Export Audio
// @version      0.1
// @description  Export an audio file of all terms in a set for listening to
// @author       Eric Waters
// @match        https://quizlet.com/*/*
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/async/1.5.2/async.min.js
// @require      https://raw.githubusercontent.com/zhuker/lamejs/master/lame.min.js
// ==/UserScript==
/* jshint -W097 */
/* global AudioContext, setPage, async, $, lamejs, QModal */
'use strict';

console.log("Quizlet Export Audio loaded");
installButton();

var context = new AudioContext();

function installButton() {
    var popout = $('.SetTools-tool.poppable .popout');
    if (popout.length === 0) {
        return;
    }
    var btn = $('<a class="SetTools-moreTool SetTools-moreTool--audio audio-tool"><span class="glyph icon audio-icon">&#xE096;</span><span class="label">Get Audio</span></a>');
    popout.append(btn);
    btn.on("click", generateAudio);
    console.log("Button installed");

}

function generateAudio() {
    console.time("generateAudio");
    console.time("fetchTermAudio");
    async.mapLimit(setPage.terms, 5, fetchTermAudio, fetchComplete);
}

function fetchTermAudio(term, cb) {
    term.audio = {};
    var forEach = function (type, cb) {
        fetchAudio(term.getAudioUrl(type), function (err, data) {
            if (err) {
                return cb(err);
            }
            term.audio[type] = data;
            return cb();
        });
    };
    async.each(["word", "definition"], forEach, function(err) { cb(err, term); });
}

function fetchAudio (url, cb) {
    var request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.responseType = 'arraybuffer';
    request.onload = function () {
        context.decodeAudioData(request.response, function (buffer) {
            cb(null, {
				buffer: buffer,
				int16: audioBufferToInt16(buffer),
			});
        }, function () {
            cb("Audio " + url + " decodeAudioData failed");
        });
    };
    request.send();
}

function fetchComplete(err, terms) {
    console.timeEnd("fetchTermAudio");
    if (err) {
        console.error(err);
        return;
    }
    var sampleRate = terms[0].audio.word.buffer.sampleRate;

    var plan = [];
    $.each(terms, function(idx, term) {
        plan.push({ audio: term.audio.definition });
        plan.push({ silence: 1.0 });
        
        plan.push({ audio: term.audio.word });
        plan.push({ silence: 1.5 });
        plan.push({ audio: term.audio.word });
        plan.push({ silence: 2.0 });
    });

    var totalLength = 0;
    $.each(plan, function(idx, item) {
        if (item.silence !== undefined) {
            totalLength += Math.floor(item.silence * sampleRate);
        }
        if (item.audio !== undefined) {
            plan[idx].offset = totalLength;
            totalLength += item.audio.buffer.length;
        }
    });

	// Use the plan to generate two items: AudioBuffer and Int16Array.
    var buf = context.createBuffer(1, totalLength, sampleRate);
    var channel = buf.getChannelData(0);
	var samples = new Int16Array(totalLength);
    $.each(plan, function(idx, item) {
        if (item.audio === undefined) {
            return;
        }
        channel.set(item.audio.buffer.getChannelData(0), item.offset);
		samples.set(item.audio.int16, item.offset);
    });
    console.timeEnd("generateAudio");

	var setTitle = $('section.SetHeader .SetTitle-title').text();
	if (!setTitle) {
		setTitle = "Set " + window.setPage.setId;
	}

    window.playBuf = function() {
        playBuffer(buf);
    };
    window.downloadWAV = function(cb) {
        var wav = audioBufferToWav(buf, { int16samples: samples });
		downloadBinaryFile(setTitle + ".wav", "audio/wav", [ new DataView(wav) ]);
    };
	window.downloadMP3 = function(cb) {
        console.time("downloadMP3");
		console.log(cb);
		var progressCallback = progressEvery(2000, function(percent, secsRemain) {
			if (secsRemain === undefined) {
				secsRemain = "Unknown";
			} else {
				secsRemain = secsRemain + " seconds";
			}
			var msg = "MP3 encode progress: " + Math.floor(percent) + "%; estimated remaining: " + secsRemain;
			console.log(msg);
			if (cb !== undefined) {
				cb(msg);
			}
		});
		var data = encodeMP3(samples, sampleRate, progressCallback);
		downloadBinaryFile(setTitle + ".mp3", "audio/mp3", data);
        console.timeEnd("downloadMP3");
	};

	var modal = $("<div class='GetAudioModal qmodal-preloaded'/>");
	var header = $('<div class="ListToggleModal-header"><h2 class="ListToggleModal-title">Get Audio</h2></div>');
	modal.append(header);
	var section = $("<div class='section'/>");
	modal.append(section);
	$(".SetHeader .container").append(modal);

	var items = [
		{ title: "Get WAV file (larger but faster)", id: "downloadWav", action: window.downloadWAV },
		{ title: "Get MP3 file (smaller but slow)", id: "downloadMP3", action: window.downloadMP3 },
	];

	QModal.open(modal, {
		on: {
			open: function() {
				var section = $('.GetAudioModal .section');
				$.each(items, function(idx, item) {
					var li = $("<li>" + item.title + "</li>");
					li.on("click", function (e) {
						item.action();
						e.preventDefault();
					});
					section.append(li);
				});
			},
		},
		includeClose: true,
	});
}

function progressEvery (interval, cb) {
	var start = Date.now(),
		lastTime = start;
	return function(cur, max) {
		var ratio = Math.max(0, Math.min(1, cur/max)),
			now = Date.now(),
			elapsed = now - start,
			sinceLast = now - lastTime;
		if (sinceLast > interval) {
			var secsRemain;
			if (cur > 1) {
				secsRemain = Math.floor(((elapsed / ratio) - elapsed) / 1000);
			}
			cb(100 * ratio, secsRemain);
			lastTime = now;
		}
	};
}

function encodeMP3 (samples, sampleRate, progressCallback) {
	var lib = new lamejs(),
		enc = new lib.Mp3Encoder(1, sampleRate, 128),
		blockSize = 1152,
		data = [],
		len = samples.length,
		i, buf;
	for (i = 0; i < len; i += blockSize) {
		progressCallback(i, len);
		buf = enc.encodeBuffer(samples.subarray(i, i + blockSize));
		if (buf.length > 0) {
			data.push(buf);
		}
	}
	buf = enc.flush();
	if (buf.length > 0) {
		data.push(buf);
	}
	return data;
}

function downloadBinaryFile (filename, type, data) {
	var blob = new window.Blob(data, {type: type}),
		url = window.URL.createObjectURL(blob),
		anchor = document.createElement('a');
	document.body.appendChild(anchor);
	anchor.style = 'display: none';
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	window.URL.revokeObjectURL(url);
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

/* https://github.com/Jam3/audiobuffer-to-wav/blob/master/index.js */
function audioBufferToInt16 (buffer) {
    var float32Arr = buffer.getChannelData(0),
		len = float32Arr.length,
		result = new Int16Array(len),
		s, i;
    for (i = 0; i < len; i++) {
        s = Math.max(-1, Math.min(1, float32Arr[i]));
        result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
	return result;
}

function audioBufferToWav (buffer, opt) {
    opt = opt || {};

    var numChannels = buffer.numberOfChannels;
    var sampleRate = buffer.sampleRate;
    var format = opt.float32 ? 3 : 1;
    var bitDepth = format === 3 ? 32 : 16;

    var samples;
	if (opt.int16samples) {
		samples = opt.int16samples;
	} else if (numChannels === 2) {
        samples = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
    } else {
        samples = buffer.getChannelData(0);
    }

    var wav = startWAV(samples, format, sampleRate, numChannels, bitDepth);
	var view;
	if (opt.int16samples) {
		view = new Int16Array(wav);
		view.set(opt.int16samples, 22);
	} else if (format === 1) { // Raw PCM
		view = new DataView(wav);
        floatTo16BitPCM(view, 44, samples);
    } else {
		view = new DataView(wav);
        writeFloat32(view, 44, samples);
    }
	return wav;
}

function startWAV (samples, format, sampleRate, numChannels, bitDepth) {
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

