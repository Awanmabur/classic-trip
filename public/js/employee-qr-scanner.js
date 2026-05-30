(function(){
  let stream = null;
  let timer = null;
  let video = null;
  let detector = null;

  async function stop(){
    if(timer){ clearInterval(timer); timer = null; }
    if(video){ try{ video.pause(); }catch(error){} video.srcObject = null; video = null; }
    if(stream){ stream.getTracks().forEach(track => track.stop()); stream = null; }
    detector = null;
  }

  async function start(targetId, options){
    await stop();
    const target = typeof targetId === 'string' ? document.getElementById(targetId) : targetId;
    if(!target) throw new Error('QR camera target is missing');
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      throw new Error('Camera API is not available in this browser');
    }

    target.innerHTML = '';
    video = document.createElement('video');
    video.setAttribute('playsinline', 'true');
    video.setAttribute('muted', 'true');
    video.muted = true;
    video.autoplay = true;
    video.style.width = '100%';
    video.style.maxHeight = '420px';
    video.style.objectFit = 'cover';
    video.style.borderRadius = '20px';
    video.style.background = '#000';
    target.appendChild(video);

    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };

    try{
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch(error){
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    video.srcObject = stream;
    await video.play();
    if(options && typeof options.onStatus === 'function') options.onStatus('Camera open');

    if('BarcodeDetector' in window){
      try{
        detector = new BarcodeDetector({ formats: ['qr_code'] });
        timer = setInterval(async function(){
          if(!video || video.readyState < 2) return;
          try{
            const codes = await detector.detect(video);
            const value = codes && codes[0] && codes[0].rawValue;
            if(value && options && typeof options.onDecode === 'function') options.onDecode(value);
          } catch(error){}
        }, 500);
        if(options && typeof options.onStatus === 'function') options.onStatus('Camera open and scanning');
      } catch(error){
        if(options && typeof options.onStatus === 'function') options.onStatus('Camera open. Manual paste may be needed on this browser.');
      }
    } else {
      if(options && typeof options.onStatus === 'function') options.onStatus('Camera open. This browser has no built-in QR decoder, so paste the code if needed.');
    }

    return stream;
  }

  window.ClassicTripQrScanner = { start, stop };
})();
