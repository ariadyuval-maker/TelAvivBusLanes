(function (global) {
    'use strict';
    const preferenceKey = 'buslanes-voice-uri';
    let selected = '';
    try { selected = localStorage.getItem(preferenceKey) || ''; } catch { /* Private browsing. */ }
    const voiceId = v => v.voiceURI || `${v.lang}:${v.name}`;
    const hebrewVoices = () => (global.speechSynthesis?.getVoices() || []).filter(v => /^he(?:-|$)/i.test(v.lang));

    function optionsFor(voices, preferred) {
        const unique = [...new Map(voices.map(v => [`${v.name}:${v.lang}`, v])).values()];
        const chosen = unique.find(v => voiceId(v) === preferred);
        return (chosen ? [chosen, ...unique.filter(v => v !== chosen)] : unique).slice(0, 3);
    }

    function bindButton(button, onToggle, onOpen, clock = global) {
        let timer;
        let suppressClick = false;
        let origin;
        const clear = () => { clock.clearTimeout(timer); timer = undefined; };
        button.addEventListener('pointerdown', e => {
            if (e.button !== 0 || e.isPrimary === false) return;
            clear();
            suppressClick = false;
            origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
            button.setPointerCapture?.(e.pointerId);
            timer = clock.setTimeout(() => { timer = undefined; suppressClick = true; onOpen(); }, 600);
        });
        button.addEventListener('pointermove', e => {
            if (origin && e.pointerId === origin.id && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 12) {
                clear();
                suppressClick = true;
            }
        });
        button.addEventListener('pointerup', () => { clear(); origin = undefined; });
        button.addEventListener('pointercancel', () => { clear(); origin = undefined; suppressClick = true; });
        button.addEventListener('lostpointercapture', clear);
        button.addEventListener('click', e => {
            if (suppressClick && e.detail !== 0) { e.preventDefault(); suppressClick = false; return; }
            onToggle();
        });
        button.addEventListener('contextmenu', e => {
            e.preventDefault();
            clear();
            if (!suppressClick) { suppressClick = true; onOpen(); }
        });
        button.addEventListener('keydown', e => {
            if ((e.shiftKey && e.key === 'F10') || (e.altKey && e.key === 'ArrowDown')) {
                e.preventDefault(); onOpen();
            }
        });
    }

    function setup(button, onToggle, onPreview) {
        const dialog = document.getElementById('voicePicker');
        const list = document.getElementById('voiceOptions');
        const status = document.getElementById('voicePickerStatus');
        button.title = 'לחיצה קצרה: הפעלה או כיבוי קול. לחיצה ארוכה: בחירת קול';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', 'voicePicker');
        const render = () => {
            list.replaceChildren();
            const voices = hebrewVoices();
            const options = optionsFor(voices, selected);
            status.textContent = options.length ? (options.length === 1 ? 'במכשיר זה זמין כרגע קול אחד בעברית.' : 'בחרו קול והאזינו לדוגמה. הבחירה תישמר במכשיר זה.') : 'לא נמצאו כרגע קולות בעברית. אם הקולות עדיין נטענים, הרשימה תתעדכן אוטומטית.';
            if (!global.speechSynthesis) status.textContent = 'הדפדפן הזה אינו תומך בהקראה קולית.';
            const current = voices.find(v => voiceId(v) === selected) || voices[0];
            options.forEach(voice => {
                const row = document.createElement('div');
                row.className = 'voice-option';
                const label = document.createElement('label');
                const radio = document.createElement('input');
                radio.type = 'radio'; radio.name = 'selectedVoice'; radio.value = voiceId(voice);
                radio.checked = voice === current;
                const name = document.createElement('span');
                // The Web Speech API does not expose gender. Show real device voice names.
                name.textContent = voice.name;
                label.append(radio, name);
                radio.addEventListener('change', () => {
                    selected = voiceId(voice);
                    try { localStorage.setItem(preferenceKey, selected); } catch { /* Selection still works for this visit. */ }
                });
                const preview = document.createElement('button');
                preview.type = 'button'; preview.textContent = 'השמעת דוגמה';
                preview.setAttribute('aria-label', `השמעת דוגמה: ${voice.name}`);
                preview.addEventListener('click', () => onPreview(voice));
                row.append(label, preview); list.append(row);
            });
        };
        const open = () => { render(); if (!dialog.open) dialog.showModal(); };
        document.getElementById('closeVoicePicker').addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
        global.speechSynthesis?.addEventListener('voiceschanged', () => { if (dialog.open) render(); });
        bindButton(button, onToggle, open);
    }

    global.BusLaneVoices = {
        setup, bindButton, optionsFor,
        getVoice: () => { const voices = hebrewVoices(); return voices.find(v => voiceId(v) === selected) || voices[0]; }
    };
})(window);
