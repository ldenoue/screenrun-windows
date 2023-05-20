let stream = null
let audioStream = null
let audioTrack = null
let FPS = 30
let WIDTH = 320
let HEIGHT = 160

async function startStream(mediaSourceId,rect) {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: mediaSourceId,
        /*maxWidth: 320,
        maxHeight: 160,
        maxFrameRate: 12,*/
      }
    }
  })
  previewvideo.srcObject = stream
}

let recording = false
let mediaRecorder = null;
let chunks = [];
let startTime = null;
let interval = null;

async function startRecording() {
  console.log('start recording')
  chunks = []
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({audio:true})
    audioTrack = audioStream.getAudioTracks()[0];
  } catch (eaudio) {
  }
  if (audioTrack)
    stream.addTrack(audioTrack);

  mediaRecorder = new MediaRecorder(stream)
  mediaRecorder.ondataavailable = function(e) {
    chunks.push(e.data);
  }
  mediaRecorder.onstop = async function(e) {
    let blob = new Blob(chunks, {type: 'video/webm'})
    window.api.write(blob)
  }
  startTime = Date.now()
  interval = setInterval(tick,1000)
  mediaRecorder.start(1000)
}

function tick() {
  let elapsed = Date.now() - startTime
  let caption = new Date(elapsed).toISOString().substr(14, 5);
  window.api.send('toMain',{recordingCaption: caption})
}
function toggleRecording() {
  recording = !recording
  if (recording) {
    window.api.send('toMain',{recordingCaption: '00:00'})
    startRecording()
  } else {
    clearInterval(interval)
    window.api.send('toMain',{recordingCaption: 'saving...'})
    stream.getAudioTracks().forEach((t) => t.stop());
    mediaRecorder.stop()
  }
}


window.api.receive("fromMain", (data) => {
  //console.log('Received from main process',data);
  /*if (data.dataurl)
  {
    previewimage.src = data.dataurl
    //previewimage.src = 'https://www.google.com/logos/google.jpg'
    debug.textContent = data.dataurl.length
  }*/
  if (data.mediaSourceId) {
    //debug.textContent = data.mediaSourceId
    startStream(data.mediaSourceId,data.rect)
  }
  if (data.toggleRecording !== undefined)
    toggleRecording()
});

previewvideo.onclick = (evt) => {
  window.api.send('toMain',{click:{x:evt.clientX,y:evt.clientY}})
}
