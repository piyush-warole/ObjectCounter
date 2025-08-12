/* js/app.js */
'use strict';

async function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

window.addEventListener('load', async () => {
  // Elements (query after DOM is ready)
  const videoEl = document.getElementById('video');
  const imageEl = document.getElementById('image');
  const overlay = document.getElementById('overlay');
  const ctx = overlay.getContext('2d');

  const startBtn = document.getElementById('startBtn');
  const stopBtn  = document.getElementById('stopBtn');
  const modeSelect = document.getElementById('modeSelect');
  const cameraSelect = document.getElementById('cameraSelect');
  const fileInput = document.getElementById('fileInput');
  const confSlider = document.getElementById('confSlider');
  const confLabel = document.getElementById('confLabel');
  const exportBtn = document.getElementById('exportBtn');

  const countPersonEl = document.getElementById('countPerson');
  const countCarEl = document.getElementById('countCar');
  const chkBoxes = Array.from(document.querySelectorAll('.countCheckbox'));

  const history = { timestamps: [], people: [], cars: [] };

  // Chart
  const chartCtx = document.getElementById('historyChart').getContext('2d');
  const historyChart = new Chart(chartCtx, {
    type: 'line',
    data: {
      labels: history.timestamps,
      datasets: [
        { label: 'People', data: history.people, tension: 0.3, fill: false },
        { label: 'Cars', data: history.cars, tension: 0.3, fill: false }
      ]
    },
    options: { animation:false, scales:{y:{beginAtZero:true}} , plugins:{legend:{position:'bottom'}} }
  });

  function getActiveClasses(){
    return chkBoxes.filter(c=>c.checked).map(c=>c.value);
  }

  function logHistory(people,cars){
    const t = new Date().toLocaleTimeString();
    history.timestamps.push(t);
    history.people.push(people);
    history.cars.push(cars);
    if(history.timestamps.length > 30){
      history.timestamps.shift(); history.people.shift(); history.cars.shift();
    }
    historyChart.update();
  }

  function fitCanvasToMedia(w,h){
    overlay.width = w;
    overlay.height = h;
    overlay.style.width = Math.min(w, 1200) + 'px';
  }

  function drawDetections(dets){
    ctx.clearRect(0,0,overlay.width, overlay.height);
    ctx.strokeStyle = '#00FF88';
    ctx.lineWidth = 2;
    ctx.font = '16px system-ui';
    ctx.fillStyle = '#00FF88';

    let people = 0, cars = 0;
    const active = getActiveClasses();
    const minConf = parseFloat(confSlider.value);

    dets.forEach(d => {
      if (d.score < minConf) return;
      if (!active.includes(d.class)) return;
      const [x,y,w,h] = d.bbox;
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.stroke();

      const label = `${d.class} ${(d.score*100).toFixed(0)}%`;
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = '#00FF88';
      ctx.fillRect(x, Math.max(0, y - 22), textWidth + 8, 20);
      ctx.fillStyle = '#000';
      ctx.fillText(label, x + 4, Math.max(12, y - 8));
      ctx.fillStyle = '#00FF88';

      if (d.class === 'person') people++;
      if (['car','truck','bus'].includes(d.class)) cars++;
    });

    countPersonEl.textContent = people;
    countCarEl.textContent = cars;
    logHistory(people, cars);
  }

  async function populateCameras(){
    try{
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      cameraSelect.innerHTML = '';
      cams.forEach((c,idx) => {
        const option = document.createElement('option');
        option.value = c.deviceId;
        option.text = c.label || `Camera ${idx+1}`;
        cameraSelect.appendChild(option);
      });
    }catch(e){
      console.warn('Camera enumeration failed:', e);
    }
  }

  let model = null;
  let running = false;
  let stream = null;

  async function startWebcam(){
    try{
      const deviceId = cameraSelect.value || undefined;
      const constraints = { video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoEl.srcObject = stream;
      await videoEl.play();
      videoEl.classList.remove('d-none');
      imageEl.classList.add('d-none');
      fitCanvasToMedia(videoEl.videoWidth, videoEl.videoHeight);
    }catch(err){
      alert('Could not start camera: ' + err.message);
      throw err;
    }
  }

  function stopWebcam(){
    if(stream){
      stream.getTracks().forEach(t=>t.stop());
      stream = null;
    }
    try { videoEl.pause(); videoEl.srcObject = null; } catch(e){}
    videoEl.classList.add('d-none');
    ctx.clearRect(0,0,overlay.width, overlay.height);
  }

  async function detectionLoopVideo(){
    while(running){
      if(videoEl && !videoEl.paused && videoEl.readyState >= 2){
        try{
          const dets = await model.detect(videoEl);
          drawDetections(dets);
        }catch(e){
          console.warn('detect error', e);
        }
      }
      await sleep(300);
    }
  }

  async function processImageFile(file){
    const url = URL.createObjectURL(file);
    imageEl.src = url;
    imageEl.onload = async () => {
      imageEl.classList.remove('d-none');
      videoEl.classList.add('d-none');
      fitCanvasToMedia(imageEl.naturalWidth, imageEl.naturalHeight);
      const dets = await model.detect(imageEl);
      drawDetections(dets);
      URL.revokeObjectURL(url);
    };
  }

  async function processVideoFile(file){
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      videoEl.srcObject = null;
      videoEl.src = url;
      videoEl.classList.remove('d-none');
      imageEl.classList.add('d-none');

      videoEl.onloadedmetadata = () => {
        fitCanvasToMedia(videoEl.videoWidth, videoEl.videoHeight);
      };

      videoEl.onplay = () => { running = true; detectionLoopVideo(); };
      videoEl.onended = () => {
        running = false;
        videoEl.pause();
        URL.revokeObjectURL(url);
        resolve();
      };
      videoEl.play().catch(e => { console.warn(e); resolve(); });
    });
  }

  function exportCSV(){
    let csv = 'time,people,cars\n';
    for(let i=0;i<history.timestamps.length;i++){
      csv += `${history.timestamps[i]},${history.people[i]},${history.cars[i]}\n`;
    }
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'counts_history.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // UI wiring
  confLabel.textContent = confSlider.value;
  confSlider.oninput = () => confLabel.textContent = confSlider.value;

  modeSelect.onchange = () => {
    const mode = modeSelect.value;
    document.getElementById('webcamControls').classList.toggle('d-none', mode !== 'webcam');
    document.getElementById('uploadControls').classList.toggle('d-none', mode === 'webcam');
  };

  startBtn.onclick = async () => {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    running = true;

    if (modeSelect.value === 'webcam') {
      try{
        await startWebcam();
        detectionLoopVideo();
      }catch(e){
        running = false;
        startBtn.disabled = false;
        stopBtn.disabled = true;
      }
    } else {
      const file = fileInput.files[0];
      if (!file) {
        alert('Choose a file first');
        running = false;
        startBtn.disabled = false;
        stopBtn.disabled = true;
        return;
      }
      if (file.type.startsWith('image/')) {
        await processImageFile(file);
      } else if (file.type.startsWith('video/')) {
        await processVideoFile(file);
      } else {
        alert('Unsupported file type');
      }
      // After processing, reset
      running = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  };

  stopBtn.onclick = () => {
    running = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    stopWebcam();
    try { videoEl.pause(); videoEl.src = ''; } catch(e){}
  };

  exportBtn.onclick = exportCSV;

  // Load model and populate cameras
  try{
    // wait for coco-ssd script to be available
    if (typeof cocoSsd === 'undefined') {
      throw new Error('COCO-SSD script not loaded. Check network or CDN.');
    }
    model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    console.log('Model loaded');
  }catch(err){
    alert('Model failed to load: ' + err.message);
    console.error(err);
    return;
  }

  await populateCameras();
});



let model;
let webcamStream = null;
let detectionRunning = false;

document.getElementById("startBtn").addEventListener("click", async () => {
    document.getElementById("landingPage").style.display = "none";
    document.getElementById("detectionSection").style.display = "block";
    document.getElementById("stopBtn").style.display = "inline-block";

    try {
        model = await cocoSsd.load();
        webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const video = document.getElementById("video");
        const canvas = document.getElementById("canvas");
        const ctx = canvas.getContext("2d");

        video.srcObject = webcamStream;
        detectionRunning = true;

        video.onloadeddata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            detectFrame();
        };

        async function detectFrame() {
            if (!detectionRunning) return;

            const predictions = await model.detect(video);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            let counts = { person: 0, car: 0, motorcycle: 0, bus: 0, truck: 0 };

            predictions.forEach(pred => {
                if (pred.score > 0.6) {
                    ctx.strokeStyle = "#00ff88";
                    ctx.lineWidth = 2;
                    ctx.strokeRect(...pred.bbox);

                    ctx.font = "16px Arial";
                    ctx.fillStyle = "rgba(0,0,0,0.5)";
                    ctx.fillRect(pred.bbox[0], pred.bbox[1] - 20, ctx.measureText(pred.class).width + 10, 20);
                    ctx.fillStyle = "#00ff88";
                    ctx.fillText(pred.class, pred.bbox[0] + 5, pred.bbox[1] - 5);

                    if (counts.hasOwnProperty(pred.class)) {
                        counts[pred.class]++;
                    }
                }
            });

            document.getElementById("personCount").innerText = counts.person;
            document.getElementById("carCount").innerText = counts.car;
            document.getElementById("bikeCount").innerText = counts.motorcycle;
            document.getElementById("busCount").innerText = counts.bus;
            document.getElementById("truckCount").innerText = counts.truck;

            requestAnimationFrame(detectFrame);
        }

    } catch (err) {
        alert("Error accessing webcam: " + err.message);
    }
});

// STOP BUTTON FUNCTIONALITY — Returns to Landing Page
document.getElementById("stopBtn").addEventListener("click", () => {
    detectionRunning = false;

    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
    }

    document.getElementById("video").srcObject = null;
    document.getElementById("stopBtn").style.display = "none";

    // Go back to landing page
    document.getElementById("detectionSection").style.display = "none";
    document.getElementById("landingPage").style.display = "block";

    console.log("Detection stopped and returned to landing page.");
});
