(() => {
  const $ = (id) => document.getElementById(id);
  const video = $('camera-video');
  const finder = document.querySelector('.viewfinder');
  const startButton = $('start-camera');
  const canvas = $('analysis-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const captureCanvas = $('capture-canvas');
  const captureCtx = captureCanvas.getContext('2d');
  let stream = null;
  let facing = 'environment';
  let model = null;
  let analyzing = false;
  let level = false;
  let lastLevel = false;
  let lastClassification = 0;
  let lastMetrics = null;
  let orientationHandler = null;
  let track = null;
  let evMin = 0;
  let evMax = 0;
  let autoExposure = true;
  let lastAutoExposure = 0;
  let orientationInitialized = false;

  function setStatus(message, active = false) {
    const badge = $('camera-state');
    badge.innerHTML = `<i></i> ${message}`;
    badge.classList.toggle('active', active);
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Нужен HTTPS или современный браузер');
      $('camera-placeholder').querySelector('b').textContent = 'Камера недоступна';
      $('camera-placeholder').querySelector('span:not(.placeholder-icon)').textContent = 'Откройте страницу по HTTPS или через localhost и проверьте поддержку камеры.';
      return;
    }
    startButton.disabled = true;
    startButton.textContent = 'Подключение…';
    initOrientation();
    try {
      stopCamera();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      video.srcObject = stream;
      await video.play();
      track = stream.getVideoTracks()[0];
      finder.classList.add('running');
      $('capture-button').disabled = false;
      $('flip-camera').disabled = false;
      setStatus('Камера активна', true);
      readCapabilities();
      requestAnimationFrame(analyzeFrame);
      loadSceneModel();
    } catch (error) {
      setStatus(error.name === 'NotAllowedError' ? 'Нет разрешения на камеру' : 'Не удалось открыть камеру');
      $('camera-placeholder').querySelector('b').textContent = error.name === 'NotAllowedError' ? 'Разрешение не получено' : 'Камера не запустилась';
      $('camera-placeholder').querySelector('span:not(.placeholder-icon)').textContent = error.message || 'Проверьте разрешения браузера и повторите попытку.';
    } finally {
      startButton.disabled = false;
      startButton.textContent = 'Повторить запуск';
    }
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((item) => item.stop());
    stream = null;
    track = null;
    video.srcObject = null;
    finder.classList.remove('running');
    $('capture-button').disabled = true;
  }

  function readCapabilities() {
    const caps = track?.getCapabilities?.() || {};
    const settings = track?.getSettings?.() || {};
    const support = [];
    if (caps.exposureCompensation) {
      evMin = caps.exposureCompensation.min ?? 0;
      evMax = caps.exposureCompensation.max ?? 0;
      const range = $('ev-range');
      range.min = evMin;
      range.max = evMax;
      range.step = caps.exposureCompensation.step || 0.1;
      range.disabled = evMin === evMax || autoExposure;
      $('ev-support').textContent = range.disabled ? 'недоступна' : 'доступна';
      support.push('экспокоррекция поддерживается');
    } else {
      $('ev-support').textContent = 'только авто';
      $('ev-range').disabled = true;
      support.push('экспокоррекция только авто');
    }
    $('camera-capabilities').textContent = `${support.join(' · ')}${settings.width ? ` · ${settings.width}×${settings.height}` : ''}. ISO и выдержку браузер не сообщает.`;
  }

  async function setExposureCompensation(value) {
    const shown = `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(1)} EV`;
    $('ev-output').value = shown;
    $('ev-value').textContent = shown;
    if (!track || $('ev-range').disabled) return;
    try {
      await track.applyConstraints({ advanced: [{ exposureCompensation: Number(value) }] });
    } catch (_) {
      $('ev-support').textContent = 'не удалось применить';
    }
  }

  function analyzeFrame() {
    if (!stream || video.readyState < 2 || analyzing) {
      if (stream) requestAnimationFrame(analyzeFrame);
      return;
    }
    analyzing = true;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const w = canvas.width;
      const h = canvas.height;
      const gray = new Uint8Array(w * h);
      let total = 0;
      let under = 0;
      let over = 0;
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        gray[j] = y;
        total += y;
        if (y < 18) under++;
        if (y > 242) over++;
      }
      let edge = 0;
      let count = 0;
      for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
        const at = y * w + x;
        edge += Math.abs(-4 * gray[at] + gray[at - 1] + gray[at + 1] + gray[at - w] + gray[at + w]);
        count++;
      }
      const brightness = total / (w * h);
      const sharpness = edge / count;
      const clipping = (under + over) / (w * h);
      const metrics = { brightness, sharpness, clipping };
      lastMetrics = metrics;
      renderMetrics(metrics);
      if (!model) evaluate(metrics);
      if (model && Date.now() - lastClassification > 3000) classifyScene();
    } catch (_) {
      $('analysis-state').textContent = 'анализ недоступен';
    }
    analyzing = false;
    if (stream) setTimeout(() => requestAnimationFrame(analyzeFrame), 400);
  }

  function renderMetrics({ brightness, sharpness, clipping }) {
    const light = brightness < 65 ? 'мало' : brightness > 190 ? 'ярко' : 'нормально';
    const sharp = sharpness < 6 ? 'низкая' : sharpness > 14 ? 'хорошая' : 'средняя';
    $('light-label').textContent = `Свет · ${light}`;
    $('sharp-label').textContent = `Резкость · ${sharp}`;
    $('analysis-state').textContent = 'в реальном времени';
    let score = 65;
    if (brightness < 65) score -= 16;
    else if (brightness > 190) score -= 12;
    else score += 8;
    score += sharpness > 14 ? 15 : sharpness < 6 ? -16 : 4;
    score -= Math.min(20, clipping * 120);
    score += level ? 8 : -2;
    score = Math.max(5, Math.min(98, Math.round(score)));
    $('frame-score').textContent = score;
    $('score-fill').style.width = `${score}%`;
    $('score-label').textContent = score >= 78 ? 'Хороший момент' : score >= 55 ? 'Можно улучшить' : 'Попробуйте поправить';
    const tips = [];
    if (brightness < 65) tips.push('Добавьте света или устойчиво держите телефон');
    if (brightness > 190 || clipping > 0.16) tips.push('В кадре возможен пересвет — смените угол или уменьшите экспозицию');
    if (sharpness < 6) tips.push('Кадр может быть смазан: коснитесь объекта и задержите дыхание');
    if (!level) tips.push('Выровняйте горизонт по центральной линии');
    if (!tips.length) tips.push('Свет и резкость выглядят хорошо. Попробуйте расположить главный объект на линии сетки.');
    $('frame-tip').textContent = tips.slice(0, 2).join(' · ');
    const iso = brightness < 65 ? '400–800' : brightness > 190 ? '50–100' : '100–200';
    const shutter = brightness < 65 ? '1/60–1/125' : brightness > 190 ? '1/500–1/1000' : '1/125–1/250';
    $('iso-value').textContent = iso;
    $('shutter-value').textContent = `${shutter} с`;
    if (autoExposure && track?.getCapabilities?.().exposureCompensation && Date.now() - lastAutoExposure > 1800) {
      const suggestedEv = brightness < 65 ? 0.7 : brightness > 190 || clipping > 0.16 ? -0.5 : 0;
      const appliedEv = Math.max(evMin, Math.min(evMax, suggestedEv));
      if (evMin !== evMax) {
        lastAutoExposure = Date.now();
        $('ev-range').value = appliedEv;
        setExposureCompensation(appliedEv);
      }
    }
    $('level-value').textContent = level ? 'ровно' : `${Math.round(currentTilt)}°`;
    $('horizon-label').textContent = `Уровень · ${Math.round(currentTilt)}°`;
  }

  let currentTilt = 0;
  function initOrientation() {
    if (orientationInitialized) return;
    orientationInitialized = true;
    const handler = (event) => {
      const angle = screen.orientation?.angle || 0;
      currentTilt = angle === 90 ? -(event.beta || 0) : angle === 270 ? (event.beta || 0) : (event.gamma || 0);
      const tilt = Math.max(-45, Math.min(45, currentTilt));
      $('horizon').style.transform = `rotate(${tilt}deg)`;
      level = Math.abs(tilt) < 1.2;
      $('horizon').classList.toggle('level', level);
      if (level && !lastLevel) navigator.vibrate?.(25);
      lastLevel = level;
      if (lastMetrics) renderMetrics(lastMetrics);
    };
    orientationHandler = handler;
    window.addEventListener('deviceorientation', orientationHandler);
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then((result) => {
        if (result !== 'granted') $('level-value').textContent = 'нет доступа';
      }).catch(() => { $('level-value').textContent = 'нет доступа'; });
    }
  }

  async function loadSceneModel() {
    $('scene-label').textContent = 'Сцена: загрузка модели';
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js');
      await tf.ready();
      model = await mobilenet.load({ version: 2, alpha: 0.5 });
      $('scene-label').textContent = 'Сцена: модель готова';
    } catch (_) {
      $('scene-label').textContent = 'Сцена: базовый анализ';
      $('analysis-state').textContent = 'без модели сцены';
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }

  async function classifyScene() {
    if (!model || analyzing || video.readyState < 2) return;
    lastClassification = Date.now();
    try {
      const predictions = await model.classify(canvas, 2);
      if (!predictions.length) return;
      const label = predictions[0].className.split(',')[0];
      $('scene-label').textContent = `Сцена: ${label}`;
      $('analysis-state').textContent = 'MobileNet · офлайн-анализ';
      if (lastMetrics) evaluate(lastMetrics);
    } catch (_) { /* Сохраняем базовую оценку, если модель не смогла классифицировать кадр. */ }
  }

  function evaluate(metrics) {
    if (metrics) renderMetrics(metrics);
  }

  function capture() {
    if (!stream || !video.videoWidth) return;
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    captureCtx.drawImage(video, 0, 0);
    captureCanvas.toBlob((blob) => {
      if (!blob) return;
      const link = $('download-link');
      if (link.dataset.url) URL.revokeObjectURL(link.dataset.url);
      const url = URL.createObjectURL(blob);
      link.dataset.url = url;
      link.href = url;
      link.hidden = false;
      link.textContent = `Скачать снимок · ${new Date().toLocaleTimeString('ru-RU')}`;
      link.click();
      navigator.vibrate?.(35);
    }, 'image/jpeg', 0.94);
  }

  startButton.addEventListener('click', startCamera);
  $('flip-camera').addEventListener('click', () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera(); });
  $('capture-button').addEventListener('click', capture);
  $('toggle-grid').addEventListener('click', (event) => {
    const grid = $('thirds-grid');
    grid.classList.toggle('off');
    event.currentTarget.textContent = grid.classList.contains('off') ? 'Сетка: выкл.' : 'Сетка: вкл.';
  });
  $('ev-range').addEventListener('input', (event) => setExposureCompensation(event.target.value));
  $('auto-exposure').addEventListener('change', (event) => {
    autoExposure = event.target.checked;
    $('ev-range').disabled = evMin === evMax || autoExposure;
    $('ev-support').textContent = autoExposure ? 'автопомощь' : evMin === evMax ? 'недоступна' : 'ручной режим';
  });
  window.addEventListener('pagehide', stopCamera);
})();
