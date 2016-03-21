// ==UserScript==
// @name         Quizlet Export Audio
// @version      0.1
// @description  Export an audio file of all terms in a set for listening to
// @author       Eric Waters
// @match        https://quizlet.com/*/*
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/async/1.5.2/async.min.js
// ==/UserScript==
/* jshint -W097 */
/* global AudioContext, setPage, async, $, lamejs, QModal */
'use strict';

console.log("Quizlet Export Audio loaded");
installButton();

var context = new AudioContext();

function installButton() {
	if ($ === undefined) {
		console.log("jQuery not loaded yet; delaying Quizlet Export Audio install");
		window.setTimeout(installButton, 100);
	}
	var modal = installModal();

	var popout = $('.SetTools-tool.poppable .popout');
	if (popout.length === 0) {
		return;
	}
	var btn = $('<a class="SetTools-moreTool SetTools-moreTool--audio audio-tool"><span class="glyph icon audio-icon">&#xE096;</span><span class="label">Get Audio</span></a>');
	popout.append(btn);
	btn.on("click", function() {
		QModal.open(modal, {
			on: { open: modalOpened },
			includeClose: true,
		});
	});
	console.log("Button installed");
}

function installModal() {
	var modal = $("<div class='GetAudioModal qmodal-preloaded'/>");
	modal.append('<div class="ListToggleModal-header"><h2 class="ListToggleModal-title">Get Audio</h2></div>');
	modal.append("<div class='section'/>");
	$(".SetHeader .container").append(modal);
	return modal;
}

function modalOpened() {
	console.info("Modal opened");
	var section = $('.GetAudioModal .section');
	section.css({
		pading: "15px 40px",
	});
	section.empty();
	var form = $('<form class="qmodal-form"/>');
	form.append("<label class='field'>" +
			"<input type='radio' name='terms' value='all' id='terms_all'/> " + 
			"<label for='terms_all'>All " + getAllTerms().length + " terms</label>" +
			"</label>");
	form.append("<label class='field'>" +
			"<input type='radio' name='terms' value='star' id='terms_star'/> " +
			"<label for='terms_star'>Only <span class='glyph icon star-icon'>&#xE041;</span> terms (" + getStarredTerms().length + " items)</label>" +
			"</label>");
	var btn = $("<button class='.ReviewFlipControls-button'>Build</button>");
	btn.on("click", function (e) {
		generateAudio();
		e.preventDefault();
	});
	var field = $("<label class='field'/>");
	field.append(btn);
	form.append(field);
	section.append(form);
}

function modalProgress(msg) {
	var section = $('.GetAudioModal .section');
	section.empty();
	section.append("<p>" + msg + "</p>");
}

function getAllTerms() {
	if (setPage !== undefined) {
		return setPage.terms;
	} else if (Cards !== undefined && Cards.data !== undefined) {
		return Cards.data.terms;
	}
}

function getSetTitle() {
	var setTitle = $('section.SetHeader .SetTitle-title').text();
	if (!setTitle) {
		if (setPage !== undefined) {
			setTitle = "Set " + window.setPage.setId;
		} else if (Cards !== undefined && Cards.data !== undefined) {
			setTitle = "Set " + Cards.data.setId;
		}
	}
	return setTitle;
}

function getStarredTerms() {
	var byId = {};
	$.each(getAllTerms(), function(idx, val) {
		byId[val.id] = val;
	});

	var terms = [];
	$("#terms .term.selected").each(function (idx, val) {
		var id = $(val).data("id");
		terms.push(byId[id]);
	});
	return terms;
}

function generateAudio() {
	var terms = [];
	var subsetTerms = $('.GetAudioModal input[name=terms]:checked').val();
	if (subsetTerms === "all") {
		terms = getAllTerms();
	} else {
		terms = getStarredTerms();
	}

	modalProgress("Starting fetch of " + terms.length + " terms");
	var progressCallback = progressEvery(500, function(percent, secsRemain) {
		modalProgress("Fetch audio progress: " + Math.floor(percent) + "%");
	});

	var i = 0;
	async.mapLimit(terms, 5, 
			function(term, cb) {
				i++;
				progressCallback(i, terms.length);
				return fetchTermAudio(term, cb);
			}, fetchComplete);
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
	if (err) {
		console.error(err);
		return;
	}
	var sampleRate = terms[0].audio.word.buffer.sampleRate;

	var plan = [];
	$.each(terms, function(idx, term) {
		plan.push({ audio: term.audio.definition });
		plan.push({ silence: 1.5 });

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

	var setTitle = getSetTitle();

	window.playBuf = function() {
		playBuffer(buf);
	};
	window.downloadWAV = function(cb) {
		var wav = audioBufferToWav(buf, { int16samples: samples });
		downloadBinaryFile(setTitle + ".wav", "audio/wav", [ new DataView(wav) ]);
		QModal.close();
	};
	window.downloadMP3 = function(cb) {
		var progressCallback = progressEvery(500, function(percent, secsRemain) {
			if (secsRemain === undefined) {
				secsRemain = "Unknown";
			} else {
				secsRemain = secsRemain + " seconds";
			}
			var msg = "MP3 encode progress: " + Math.floor(percent) + "%; estimated remaining: " + secsRemain;
			if (cb !== undefined) {
				cb(msg);
			} else {
				console.log(msg);
			}
		});
		var completeCallback = function(data) {
			downloadBinaryFile(setTitle + ".mp3", "audio/mp3", data);
			QModal.close();
		};
		encodeMP3Worker(samples, sampleRate, progressCallback, completeCallback);
	};

	var items = [
		{ label: "Get WAV file", desc: "larger but faster", id: "downloadWav", action: window.downloadWAV },
		{ label: "Get MP3 file", desc: "smaller but slow", id: "downloadMP3", action: window.downloadMP3 },
	];
	var section = $('.GetAudioModal .section');
	section.empty();
	var form = $('<form class="qmodal-form"/>');
	$.each(items, function(idx, item) {
		var btn = $("<button class='.ReviewFlipControls-button'>" + item.label + "</button>");
		btn.on("click", function (e) {
			item.action(modalProgress);
			e.preventDefault();
		});
		var field = $("<label class='field'/>");
		field.append(btn);
		field.append("<span>" + item.desc + "</span>");
		form.append(field);
	});
	section.append(form);
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

function fetchLameLib(cb) {
	var req = new XMLHttpRequest();
	req.open('GET', 'https://raw.githubusercontent.com/zhuker/lamejs/master/lame.min.js');
	req.addEventListener("load", function() {
		cb(null, this.responseText);
	});
	req.send();
}

function encodeMP3Worker (samples, sampleRate, progressCallback, completeCallback) {
	fetchLameLib(function(err, js) {
		if (err) {
			console.error(err);
			return;
		}

		js += `
			self.addEventListener("message", function(e) {
				var lib = new lamejs(),
					enc = new lib.Mp3Encoder(1, e.data.sampleRate, 128),
					blockSize = 1152,
					data = [],
					samples = e.data.samples,
					len = samples.length,
					i, buf;
				for (i = 0; i < len; i += blockSize) {
					self.postMessage({ progress: [i, len] });
					buf = enc.encodeBuffer(samples.subarray(i, i + blockSize));
					if (buf.length > 0) {
						data.push(buf);
					}
				}
				buf = enc.flush();
				if (buf.length > 0) {
					data.push(buf);
				}
				self.postMessage({ complete: data });
				self.close();
			}, false);
		`;

		var msg = {
			samples: samples,
			sampleRate: sampleRate,
		};
		var xfer = [ samples.buffer ];

		var blob = new Blob([js]),
			url = window.URL.createObjectURL(blob),
			worker = new Worker(url);
		worker.addEventListener('message', function(e) {
			if (e.data.progress) {
				progressCallback(e.data.progress[0], e.data.progress[1]);
			} else if (e.data.complete) {
				completeCallback(e.data.complete);
			}
		}, false);
		worker.postMessage(msg, xfer);
	});
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

/* https://github.com/Jam3/audiobuffer-to-wav/blob/master/index.js */
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
