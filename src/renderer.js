let streams = {}
let audio = new Audio('funk.webm');
let p = window.api.platform() || 'win32'

function playSound() {
  audio.currentTime = 0;
  audio.play();
}
async function startStream(mediaSourceId,bounds) {
  playSound()
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: mediaSourceId,
        /* Laurent: Windows doesn't like these
        maxFrameRate: 30,
        maxWidth: bounds.width,
        maxHeight: bounds.height
        */
      }
    }
  })
  streams[mediaSourceId] = stream
  handleStream(mediaSourceId,stream,bounds)
}

let previewScale = 1
function scalex(x) {
  return (x / previewScale) + 'px'
}

function scaley(y) {
  return (y / previewScale) + 'px'
}

function handleStream (mediaSourceId,stream,bounds) {
  const video = document.createElement('video')
  video.id = mediaSourceId
  video.srcObject = stream
  //if (p === 'win32')
  //  video.classList.add('square')
  //console.log(bounds)
  video.muted = true
  video.autoplay = true
  video.style.left = scalex(bounds.x)
  video.style.top = scaley(bounds.y)
  video.style.width = scalex(bounds.width)
  video.style.height = scaley(bounds.height)
  document.body.appendChild(video)
}

async function stopStream(mediaSourceId) {
  playSound()

  let video = document.getElementById(mediaSourceId)
  if (video)
    video.remove()
  let stream = streams[mediaSourceId]
  if (!stream)
    return
  stream.getTracks().forEach(function(track) {
    track.stop();
  });
}

function moveWindow(mediaSourceId,bounds) {
  let video = document.getElementById(mediaSourceId)
  if (!video)
    return
  video.style.left = scalex(bounds.x)
  video.style.top = scaley(bounds.y)
  video.style.width = scalex(bounds.width)
  video.style.height = scaley(bounds.height)
}

function containsPoint(box,pos) {
  if (pos.x < box.x)
    return false
  if (pos.y < box.y)
    return false
  if (pos.x > (box.x + box.width))
    return false
  if (pos.y > (box.y + box.height))
    return false
  return true
}

function findVideoUnder(pos) {
  let videos = [...document.querySelectorAll('video')]
  videos.sort((a,b) => parseInt(b.style.zIndex) - parseInt(a.style.zIndex))
  for (let v of videos) {
    let box = v.getBoundingClientRect();
    if (containsPoint(box,pos)) {
      window.api.send('toMain',{videoClicked:v.id})
      return
    }
  }
}

function orderVideos(ids) {
  let zIndex = 200;
  for (let id of ids) {
    let video = document.getElementById(id)
    if (video)
      video.style.zIndex = zIndex--
  }
}

window.api.receive("fromMain", (data) => {
  //console.log('Received from main process',data);
  if (data.start)
    startStream(data.start,data.bounds)
  else if (data.stop)
    stopStream(data.stop)
  else if (data.move)
    moveWindow(data.move,data.bounds)
  else if (data.cursor) {
    cursor.style.left = data.cursor.x + 'px'
    cursor.style.top = data.cursor.y + 'px'
  }
  else if (data.click) {
    let x = data.click.x * data.scale;
    let y = data.click.y * data.scale;
    findVideoUnder({x,y})
  }
  else if (data.order) {
    orderVideos(data.order)
  }
  else if (data.showMenu !== undefined)
    menuview.style.display = data.showMenu?'block':'none'
  else if (data.showDock !== undefined)
    dockview.style.display = data.showDock?'block':'none'
  else if (data.textOverlay !== undefined)
  {
    labelview.textContent = data.textOverlay?data.textOverlay:''
    labelview.style.display = 'block'
  }
  else if (data.background) {
    desktopview.src = data.background
    desktopview.style.display = 'block'
  }
  else if (data.dock)
    dockview.src = data.dock
});

if (p === 'win32') {
  labelview.classList.add('windowslabel')
}