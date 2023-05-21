let stream = null
let audioStream = null
let audioTrack = null
//let FPS = 30
//let WIDTH = 320
//let HEIGHT = 160
//let p = window.api.platform() || 'win32'
let recording = false
let mediaRecorder = null;
let chunks = [];
let startTime = null;
let interval = null;

//let streams = {}
/*let audio = new Audio('funk.webm');

function playSound() {
  audio.currentTime = 0;
  audio.play();
}*/


async function startStream(mediaSourceId) {
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
  //previewvideo.srcObject = stream
}

async function startRecording() {
  console.log('start recording')
  //playSound()
  chunks = []
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({audio:true})
    audioTrack = audioStream.getAudioTracks()[0];
  } catch (eaudio) {
  }
  if (audioTrack)
    stream.addTrack(audioTrack);

  let options = { mimeType: 'video/webm;codecs=h264,opus'}
  mediaRecorder = new MediaRecorder(stream, options)
  mediaRecorder.ondataavailable = function(e) {
    chunks.push(e.data);
  }
  mediaRecorder.onstop = async function(e) {
    let blob = new Blob(chunks, {type: 'video/webm'})
    let buffer = await blob.arrayBuffer()
    buffer.fileStart = 0
    window.api.write(blob)
  }
  startTime = Date.now()
  window.api.send('toMain',{startTime})
  interval = setInterval(tick,1000)
  mediaRecorder.start(1000)
}

function tick() {
  let elapsed = Date.now() - startTime
  let caption = new Date(elapsed).toISOString().substr(14, 5);
  window.api.send('toMain',{recordingCaption: caption})
}

function stopRecording() {
  clearInterval(interval)
  window.api.send('toMain',{recordingCaption: 'saving...'})
  stream.getAudioTracks().forEach((t) => t.stop());
  mediaRecorder.stop()

}

if (window.api)
window.api.receive("fromMain", (data) => {
  if (data.start) {
    startStream(data.start)
    setTimeout(() => {
      startRecording()
    },2000) // wait 2 seconds for Chrome to get the stream in order
  }
  else if (data.stop)
    stopRecording()
});
