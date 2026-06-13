// ============================================================
// Meeting Intelligence Dashboard — Core Application
// ============================================================

(function () {
    'use strict';

    // ─── DOM References ────────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const DOM = {
        apiKey: $('#api-key'),
        modelSelect: $('#model-select'),
        meetingTitle: $('#meeting-title'),
        meetingDate: $('#meeting-date'),
        meetingDuration: $('#meeting-duration'),
        participants: $('#participants'),
        languageSelect: $('#language-select'),
        transcriptInput: $('#transcript-input'),
        btnProcess: $('#btn-process'),
        btnSample: $('#btn-sample'),
        btnSampleAlt: $('#btn-sample-alt'),
        btnClear: $('#btn-clear'),
        outputPanel: $('#output-panel'),
        outputEmpty: $('#output-empty'),
        outputContent: $('#output-content'),
        overlay: $('#processing-overlay'),
        progressBar: $('#processing-progress-bar'),
        stepText: $('#processing-step-text'),
        stepsList: $('#processing-steps-list'),
        toastContainer: $('#toast-container'),
        // Audio upload elements
        uploadZone: $('#upload-zone'),
        audioFileInput: $('#audio-file-input'),
        uploadZoneContent: $('#upload-zone-content'),
        uploadFileInfo: $('#upload-file-info'),
        uploadFileName: $('#upload-file-name'),
        uploadFileSize: $('#upload-file-size'),
        btnRemoveFile: $('#btn-remove-file'),
        btnTranscribe: $('#btn-transcribe'),
        uploadProgressSection: $('#upload-progress-section'),
        uploadProgressLabel: $('#upload-progress-label'),
        uploadProgressBarFill: $('#upload-progress-bar-fill'),
    };

    // ─── State ──────────────────────────────────────────────────
    let selectedAudioFile = null;

    // ─── Speaker Colors ────────────────────────────────────────
    const SPEAKER_COLORS = [
        '#00d4ff', '#7c3aed', '#10b981', '#f59e0b',
        '#ef4444', '#ec4899', '#f97316', '#3b82f6',
    ];

    // ─── OpenAI API ────────────────────────────────────────────
    async function callOpenAI(messages, options = {}) {
        const apiKey = DOM.apiKey.value.trim();
        if (!apiKey) throw new Error('OpenAI API key is required.');

        const model = DOM.modelSelect.value || 'gpt-4o-mini';
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: options.temperature ?? 0.3,
                max_tokens: options.maxTokens ?? 4096,
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `API error: ${res.status}`);
        }

        const data = await res.json();
        return data.choices[0].message.content;
    }

    // ─── Transcript Parsing ────────────────────────────────────
    function parseTranscript(raw) {
        const lines = raw.trim().split('\n');
        const segments = [];
        let currentSegment = null;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Match: [00:00:05] SPEAKER_00: text
            const match = trimmed.match(
                /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(SPEAKER_\d+|[A-Z][A-Za-z_\s]+?):\s*(.+)$/
            );

            if (match) {
                currentSegment = {
                    timestamp: match[1],
                    speaker: match[2].trim(),
                    text: match[3].trim(),
                };
                segments.push(currentSegment);
            } else if (currentSegment) {
                // Continuation line
                currentSegment.text += ' ' + trimmed;
            }
        }

        return segments;
    }

    // ─── Speaker Name Mapping ──────────────────────────────────
    function parseSpeakerMap(input) {
        const map = {};
        if (!input || !input.trim()) return map;

        input.split(',').forEach((pair) => {
            const [key, val] = pair.split('=').map((s) => s.trim());
            if (key && val) map[key] = val;
        });

        return map;
    }

    function applySpeakerNames(segments, nameMap) {
        return segments.map((seg) => ({
            ...seg,
            speaker: nameMap[seg.speaker] || seg.speaker,
            originalSpeaker: seg.speaker,
        }));
    }

    // ─── Step Progress Helpers ──────────────────────────────────
    function showOverlay() {
        DOM.overlay.classList.add('active');
        $$('.step-item').forEach((el) => {
            el.classList.remove('active', 'done');
            el.querySelector('.step-icon').textContent = '○';
        });
    }

    function hideOverlay() {
        DOM.overlay.classList.remove('active');
    }

    function updateStep(stepNum, total, label) {
        DOM.stepText.textContent = label;
        const pct = Math.round((stepNum / total) * 100);
        DOM.progressBar.style.width = pct + '%';

        $$('.step-item').forEach((el) => {
            const s = parseInt(el.dataset.step);
            if (s < stepNum) {
                el.classList.remove('active');
                el.classList.add('done');
                el.querySelector('.step-icon').textContent = '✓';
            } else if (s === stepNum) {
                el.classList.add('active');
                el.querySelector('.step-icon').textContent = '◉';
            }
        });
    }

    function finalizeSteps() {
        $$('.step-item').forEach((el) => {
            el.classList.remove('active');
            el.classList.add('done');
            el.querySelector('.step-icon').textContent = '✓';
        });
        DOM.progressBar.style.width = '100%';
        DOM.stepText.textContent = 'Complete!';
    }

    // ─── Toast ─────────────────────────────────────────────────
    function showToast(msg, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span>${type === 'success' ? '✅' : '❌'}</span><span>${msg}</span>`;
        DOM.toastContainer.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    // ─── Utility ───────────────────────────────────────────────
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function timestampToSeconds(ts) {
        const parts = ts.split(':').map(Number);
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    function formatDuration(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        if (m === 0) return `${s}s`;
        return `${m}m ${s}s`;
    }

    // ─── CLIENT-SIDE: Speaker Statistics ───────────────────────
    function computeSpeakerStats(segments) {
        const speakers = {};
        const speakerOrder = [];

        segments.forEach((seg, i) => {
            if (!speakers[seg.speaker]) {
                speakers[seg.speaker] = {
                    name: seg.speaker,
                    interventions: 0,
                    totalWords: 0,
                    firstAppearance: seg.timestamp,
                    segments: [],
                };
                speakerOrder.push(seg.speaker);
            }
            const s = speakers[seg.speaker];
            s.interventions++;
            s.totalWords += seg.text.split(/\s+/).length;
            s.lastAppearance = seg.timestamp;
            s.segments.push(seg);
        });

        // Estimate speaking time from timestamps
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const startSec = timestampToSeconds(seg.timestamp);
            let endSec;
            if (i + 1 < segments.length) {
                endSec = timestampToSeconds(segments[i + 1].timestamp);
            } else {
                // Estimate last segment at ~15 seconds
                endSec = startSec + Math.min(seg.text.split(/\s+/).length * 0.4, 30);
            }
            const dur = Math.max(endSec - startSec, 1);
            if (!speakers[seg.speaker].speakingTime) speakers[seg.speaker].speakingTime = 0;
            speakers[seg.speaker].speakingTime += dur;
        }

        return { speakers, speakerOrder };
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN PIPELINE
    // ═══════════════════════════════════════════════════════════
    async function processMeeting() {
        // Validate
        const apiKey = DOM.apiKey.value.trim();
        if (!apiKey) { showToast('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', 'error'); return; }

        const rawTranscript = DOM.transcriptInput.value.trim();
        if (!rawTranscript) { showToast('Please paste a meeting transcript.', 'error'); return; }

        const segments = parseTranscript(rawTranscript);
        if (segments.length === 0) { showToast('Could not parse any transcript segments. Check the format.', 'error'); return; }

        DOM.btnProcess.disabled = true;
        showOverlay();

        const TOTAL_STEPS = 9;
        const results = {};

        try {
            // ── Metadata ───────────────────────────────────
            results.metadata = {
                title: DOM.meetingTitle.value || 'Untitled Meeting',
                date: DOM.meetingDate.value || new Date().toISOString().split('T')[0],
                duration: DOM.meetingDuration.value || 'Not specified',
                language: DOM.languageSelect.value,
            };

            const nameMap = parseSpeakerMap(DOM.participants.value);

            // ── STEP 1: Transcript Validation & Cleaning ───
            updateStep(1, TOTAL_STEPS, 'Validating and cleaning transcript...');

            const fullTranscript = segments
                .map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`)
                .join('\n');

            const cleanedRaw = await callOpenAI([
                {
                    role: 'system',
                    content: `You are a transcript cleaning assistant. Clean the following meeting transcript:
- Remove filler words (um, uh, hmm, you know, like, basically, etc.) where appropriate.
- Correct obvious ASR/speech-to-text mistakes using context.
- Fix punctuation and capitalization.
- Preserve important technical terms, names, numbers, dates, and action items.
- Do NOT hallucinate or add any content not in the original.
- Do NOT summarize.
- Maintain the EXACT format: [TIMESTAMP] SPEAKER_LABEL: Text
- Return ONLY the cleaned transcript, nothing else.`,
                },
                { role: 'user', content: fullTranscript },
            ]);

            const cleanedSegments = parseTranscript(cleanedRaw);
            const finalSegments = cleanedSegments.length > 0 ? cleanedSegments : segments;

            // ── STEP 2: Speaker Mapping ────────────────────
            updateStep(2, TOTAL_STEPS, 'Mapping speakers...');

            const mappedSegments = applySpeakerNames(finalSegments, nameMap);
            const { speakers, speakerOrder } = computeSpeakerStats(mappedSegments);

            results.speakers = speakers;
            results.speakerOrder = speakerOrder;
            results.totalSpeakers = speakerOrder.length;

            // ── STEP 3: Language Detection & Translation ────
            updateStep(3, TOTAL_STEPS, 'Detecting language and translating if needed...');

            let translatedSegments = mappedSegments;
            const selectedLang = DOM.languageSelect.value;

            const langCheckTranscript = mappedSegments
                .map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`)
                .join('\n');

            const langResult = await callOpenAI([
                {
                    role: 'system',
                    content: `You are a language detection and translation assistant.

Given the following meeting transcript, do the following:
1. Detect the language. Is it English, Hindi, Hinglish (mixed Hindi-English), or another language?
2. If the transcript is NOT in English (e.g., Hindi, Hinglish, or mixed), translate the ENTIRE transcript into professional English while preserving:
   - Speaker labels and timestamps exactly as they are
   - Meaning and intent
   - Technical terms and proper nouns
   - Do NOT summarize during translation
3. If the transcript is already in English, return it unchanged.

The user indicated the language is: ${selectedLang}

Return your response in this exact JSON format:
{
  "detected_language": "English|Hindi|Hinglish|Mixed|Other",
  "was_translated": true/false,
  "transcript": "[TIMESTAMP] SPEAKER: translated text\\n..."
}

Return ONLY the JSON, no markdown fences.`,
                },
                { role: 'user', content: langCheckTranscript },
            ], { maxTokens: 8192 });

            try {
                const langData = JSON.parse(langResult);
                results.detectedLanguage = langData.detected_language || 'English';
                results.wasTranslated = langData.was_translated || false;
                if (langData.was_translated && langData.transcript) {
                    const translatedParsed = parseTranscript(langData.transcript);
                    if (translatedParsed.length > 0) {
                        translatedSegments = applySpeakerNames(translatedParsed, nameMap);
                    }
                }
            } catch {
                results.detectedLanguage = 'English';
                results.wasTranslated = false;
            }

            results.transcript = translatedSegments;

            // ── STEP 4: Structured Transcript ──────────────
            updateStep(4, TOTAL_STEPS, 'Generating structured transcript...');
            // Already structured from parsing — results.transcript is ready
            await new Promise((r) => setTimeout(r, 300)); // Brief visual delay

            // ── STEP 5: Executive Summary ──────────────────
            updateStep(5, TOTAL_STEPS, 'Generating executive summary...');

            const transcriptForAnalysis = translatedSegments
                .map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`)
                .join('\n');

            const summaryRaw = await callOpenAI([
                {
                    role: 'system',
                    content: `You are an expert meeting analyst. Given the following meeting transcript, create a comprehensive executive summary.

Return your response in this exact JSON format:
{
  "meeting_purpose": "Brief description of what this meeting was about",
  "main_discussion_points": ["point 1", "point 2", ...],
  "key_decisions": ["decision 1", "decision 2", ...],
  "risks_or_issues": ["risk 1", "risk 2", ...],
  "open_questions": ["question 1", "question 2", ...],
  "next_steps": ["step 1", "step 2", ...]
}

Be specific and factual. Do NOT invent information not present in the transcript.
Return ONLY the JSON, no markdown fences.`,
                },
                { role: 'user', content: transcriptForAnalysis },
            ]);

            try {
                results.summary = JSON.parse(summaryRaw);
            } catch {
                // Try to extract JSON from the response
                const jsonMatch = summaryRaw.match(/\{[\s\S]*\}/);
                results.summary = jsonMatch ? JSON.parse(jsonMatch[0]) : {
                    meeting_purpose: 'Unable to parse summary.',
                    main_discussion_points: [],
                    key_decisions: [],
                    risks_or_issues: [],
                    open_questions: [],
                    next_steps: [],
                };
            }

            // ── STEP 6: Action Items ───────────────────────
            updateStep(6, TOTAL_STEPS, 'Extracting action items...');

            const actionRaw = await callOpenAI([
                {
                    role: 'system',
                    content: `You are an expert meeting analyst. Extract all action items from the following meeting transcript.

For each action item, identify:
- Task: What needs to be done
- Owner: Who is responsible (use speaker name from transcript, or "Not Specified" if unclear)
- Due Date: When it's due (or "Not Mentioned" if not stated)
- Priority: High, Medium, or Low (infer from context and urgency)

Return your response in this exact JSON format:
{
  "action_items": [
    {"task": "...", "owner": "...", "due_date": "...", "priority": "High|Medium|Low"},
    ...
  ]
}

Only extract action items that are clearly supported by the transcript. Do NOT invent tasks.
Return ONLY the JSON, no markdown fences.`,
                },
                { role: 'user', content: transcriptForAnalysis },
            ]);

            try {
                const actionData = JSON.parse(actionRaw);
                results.actionItems = actionData.action_items || [];
            } catch {
                const jsonMatch = actionRaw.match(/\{[\s\S]*\}/);
                results.actionItems = jsonMatch ? (JSON.parse(jsonMatch[0]).action_items || []) : [];
            }

            // ── STEP 7: Speaker Analysis ───────────────────
            updateStep(7, TOTAL_STEPS, 'Analyzing speakers...');

            const speakerAnalysisRaw = await callOpenAI([
                {
                    role: 'system',
                    content: `You are a meeting analysis expert. Analyze each speaker's contributions from this transcript.

For each speaker, provide:
- main_topics: Array of main topics they discussed
- key_contributions: Array of their key contributions or statements
- role_inference: Your best guess at their role based on what they said (e.g., "Project Manager", "Developer", "Stakeholder", etc.)

Return your response in this exact JSON format:
{
  "speakers": {
    "SPEAKER_NAME": {
      "main_topics": ["topic1", "topic2"],
      "key_contributions": ["contribution1", "contribution2"],
      "role_inference": "Likely role"
    },
    ...
  }
}

Use the speaker names exactly as they appear in the transcript.
Return ONLY the JSON, no markdown fences.`,
                },
                { role: 'user', content: transcriptForAnalysis },
            ]);

            try {
                const saData = JSON.parse(speakerAnalysisRaw);
                results.speakerAnalysis = saData.speakers || {};
            } catch {
                const jsonMatch = speakerAnalysisRaw.match(/\{[\s\S]*\}/);
                results.speakerAnalysis = jsonMatch ? (JSON.parse(jsonMatch[0]).speakers || {}) : {};
            }

            // ── STEP 8: Sentiment Analysis ─────────────────
            updateStep(8, TOTAL_STEPS, 'Analyzing sentiment...');

            const sentimentRaw = await callOpenAI([
                {
                    role: 'system',
                    content: `You are a sentiment analysis expert. Analyze the sentiment of this meeting transcript.

Provide:
1. Overall meeting sentiment (Positive, Neutral, Negative, or Mixed)
2. Per-speaker sentiment
3. Confidence level (High, Medium, Low)
4. Areas of agreement
5. Areas of disagreement

Return your response in this exact JSON format:
{
  "overall_sentiment": "Positive|Neutral|Negative|Mixed",
  "overall_confidence": "High|Medium|Low",
  "per_speaker": {
    "SPEAKER_NAME": {
      "sentiment": "Positive|Neutral|Negative|Mixed",
      "confidence": "High|Medium|Low"
    }
  },
  "areas_of_agreement": ["area1", "area2"],
  "areas_of_disagreement": ["area1", "area2"]
}

Use speaker names exactly as they appear in the transcript.
Return ONLY the JSON, no markdown fences.`,
                },
                { role: 'user', content: transcriptForAnalysis },
            ]);

            try {
                results.sentiment = JSON.parse(sentimentRaw);
            } catch {
                const jsonMatch = sentimentRaw.match(/\{[\s\S]*\}/);
                results.sentiment = jsonMatch ? JSON.parse(jsonMatch[0]) : {
                    overall_sentiment: 'Neutral',
                    overall_confidence: 'Low',
                    per_speaker: {},
                    areas_of_agreement: [],
                    areas_of_disagreement: [],
                };
            }

            // ── STEP 9: Final Output ───────────────────────
            updateStep(9, TOTAL_STEPS, 'Assembling final output...');
            await new Promise((r) => setTimeout(r, 400));

            finalizeSteps();
            await new Promise((r) => setTimeout(r, 600));

            hideOverlay();
            renderOutput(results);
            showToast('Meeting analysis complete!');

        } catch (err) {
            hideOverlay();
            showToast('Error: ' + err.message, 'error');
            console.error(err);
        } finally {
            DOM.btnProcess.disabled = false;
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  RENDER OUTPUT
    // ═══════════════════════════════════════════════════════════
    function renderOutput(r) {
        DOM.outputEmpty.style.display = 'none';
        DOM.outputContent.style.display = 'flex';
        DOM.outputContent.style.flexDirection = 'column';
        DOM.outputContent.style.gap = '24px';

        const speakerColorMap = {};
        r.speakerOrder.forEach((name, i) => {
            speakerColorMap[name] = SPEAKER_COLORS[i % SPEAKER_COLORS.length];
        });

        let html = '';

        // ── Export Bar ──────────────────────────────────────
        html += `
        <div class="export-bar">
            <button class="btn btn-secondary btn-sm" id="btn-export-md">📄 Export Markdown</button>
            <button class="btn btn-secondary btn-sm" id="btn-copy-all">📋 Copy All</button>
        </div>`;

        // ── 1. Meeting Information ──────────────────────────
        html += `
        <div class="output-section card">
            <div class="section-header">
                <div class="section-title-group">
                    <div class="section-icon card-icon cyan">📋</div>
                    <h2 class="section-title">Meeting Information</h2>
                </div>
            </div>
            <div class="info-grid">
                <div class="info-item">
                    <div class="info-label">Title</div>
                    <div class="info-value">${escapeHtml(r.metadata.title)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Date</div>
                    <div class="info-value">${escapeHtml(r.metadata.date)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Duration</div>
                    <div class="info-value">${escapeHtml(r.metadata.duration)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Language</div>
                    <div class="info-value">${escapeHtml(r.detectedLanguage)}${r.wasTranslated ? ' → English (Translated)' : ''}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Total Speakers</div>
                    <div class="info-value">${r.totalSpeakers}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Total Segments</div>
                    <div class="info-value">${r.transcript.length}</div>
                </div>
            </div>
        </div>`;

        // ── 2. Speaker Statistics ───────────────────────────
        html += `
        <div class="output-section card">
            <div class="section-header">
                <div class="section-title-group">
                    <div class="section-icon card-icon purple">👥</div>
                    <h2 class="section-title">Speaker Statistics</h2>
                </div>
            </div>
            <div class="speaker-stats-grid">`;

        r.speakerOrder.forEach((name, i) => {
            const s = r.speakers[name];
            const color = speakerColorMap[name];
            const initials = name.replace('SPEAKER_', 'S').substring(0, 3).toUpperCase();
            html += `
                <div class="speaker-stat-card">
                    <div class="speaker-avatar" style="background: ${color}33; color: ${color}; border: 2px solid ${color}55;">${initials}</div>
                    <div class="speaker-stat-info">
                        <div class="speaker-stat-name">${escapeHtml(name)}</div>
                        <div class="speaker-stat-detail">${s.interventions} interventions · ~${formatDuration(s.speakingTime || 0)}</div>
                    </div>
                </div>`;
        });

        html += `</div></div>`;

        // ── 3. English Transcript ──────────────────────────
        html += `
        <div class="output-section card">
            <div class="section-header">
                <div class="section-title-group">
                    <div class="section-icon card-icon green">📝</div>
                    <h2 class="section-title">English Transcript</h2>
                </div>
            </div>
            <div class="transcript-container">`;

        r.transcript.forEach((seg) => {
            const color = speakerColorMap[seg.speaker] || '#94a3b8';
            html += `
                <div class="transcript-entry">
                    <div class="transcript-timestamp">${escapeHtml(seg.timestamp)}</div>
                    <div>
                        <div class="transcript-speaker">
                            <span class="speaker-dot" style="background: ${color};"></span>
                            <span style="color: ${color};">${escapeHtml(seg.speaker)}</span>
                        </div>
                        <div class="transcript-text">${escapeHtml(seg.text)}</div>
                    </div>
                </div>`;
        });

        html += `</div></div>`;

        // ── 4. Executive Summary ───────────────────────────
        const sm = r.summary;
        html += `
        <div class="output-section card">
            <div class="section-header">
                <div class="section-title-group">
                    <div class="section-icon card-icon yellow">📊</div>
                    <h2 class="section-title">Executive Summary</h2>
                </div>
            </div>
            <div class="summary-content">
                <div class="summary-block">
                    <div class="summary-block-title">🎯 Meeting Purpose</div>
                    <div class="summary-block-text">${escapeHtml(sm.meeting_purpose || 'Not identified')}</div>
                </div>
                <div class="summary-block">
                    <div class="summary-block-title">💬 Main Discussion Points</div>
                    <ul>${(sm.main_discussion_points || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
                </div>
                <div class="summary-block">
                    <div class="summary-block-title">🚀 Next Steps</div>
                    <ul>${(sm.next_steps || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
                </div>
            </div>
        </div>`;

        // ── 5. Key Decisions ───────────────────────────────
        const decisions = sm.key_decisions || [];
        html += `
        <div class="output-section card">
            <div class="section-header">
                <div class="section-title-group">
                    <div class="section-icon card-icon green">✅</div>
                    <h2 class="section-title">Key Decisions</h2>
                </div>
            </div>
            <div class="decision-list">
                ${decisions.length === 0 ? '<p style="color: var(--text-muted); font-size: 0.875rem;">No key decisions identified.</p>' :
                decisions.map((d) => `<div class="decision-item"><span>✅</span><span>${escapeHtml(d)}</span></div>`).join('')}
            </div>
        </div>`;

        // ── 6. Action Items ────────────────────────────────
        html += `
        <div class="output-section card">
            <div class="section-header">
                <div class="section-title-group">
                    <div class="section-icon card-icon cyan">⚡</div>
                    <h2 class="section-title">Action Items</h2>
                </div>
            </div>
            <div class="action-table-wrapper">
                <table class="action-table">
                    <thead>
                        <tr><th>Task</th><th>Owner</th><th>Due Date</th><th>Priority</th></tr>
                    </thead>
                    <tbody>`;

        if (r.actionItems.length === 0) {
            html += `<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">No action items identified.</td></tr>`;
        } else {
            r.actionItems.forEach((item) => {
                const priorityClass = (item.priority || '').toLowerCase();
                html += `
                    <tr>
                        <td>${escapeHtml(item.task)}</td>
                        <td>${escapeHtml(item.owner || 'Not Specified')}</td>
                        <td>${escapeHtml(item.due_date || 'Not Mentioned')}</td>
                        <td><span class="priority-badge priority-${priorityClass}">${escapeHtml(item.priority || 'Medium')}</span></td>
                    </tr>`;
            });
        }

        html += `</tbody></table></div></div>`;

        // ── 7. Risks & Concerns ────────────────────────────
        const risks = sm.risks_or_issues || [];
        html += `
        <div class="output-section card">
            <div class="section-header">
                <div class="section-title-group">
                    <div class="section-icon card-icon red">⚠️</div>
                    <h2 class="section-title">Risks & Concerns</h2>
                </div>
            </div>
            <div class="alert-list">
                ${risks.length === 0 ? '<p style="color: var(--text-muted); font-size: 0.875rem;">No risks or concerns identified.</p>' :
                risks.map((r) => `<div class="alert-item risk"><span class="alert-icon">⚠️</span><span>${escapeHtml(r)}</span></div>`).join('')}
            </div>
        </div>`;

        // ── 8. Open Questions ──────────────────────────────
        const questions = sm.open_questions || [];
        html += `
        <div class="output-section card">
            <div class="section-header">
                <div class="section-title-group">
                    <div class="section-icon card-icon blue">❓</div>
                    <h2 class="section-title">Open Questions</h2>
                </div>
            </div>
            <div class="alert-list">
                ${questions.length === 0 ? '<p style="color: var(--text-muted); font-size: 0.875rem;">No open questions identified.</p>' :
                questions.map((q) => `<div class="alert-item question"><span class="alert-icon">❓</span><span>${escapeHtml(q)}</span></div>`).join('')}
            </div>
        </div>`;

        // ── 9. Speaker Analysis ────────────────────────────
        html += `
        <div class="output-section card">
            <div class="section-header">
                <div class="section-title-group">
                    <div class="section-icon card-icon purple">🎤</div>
                    <h2 class="section-title">Speaker Analysis</h2>
                </div>
            </div>
            <div class="speaker-analysis-list">`;

        r.speakerOrder.forEach((name, i) => {
            const s = r.speakers[name];
            const color = speakerColorMap[name];
            const analysis = r.speakerAnalysis[name] || {};
            const initials = name.replace('SPEAKER_', 'S').substring(0, 3).toUpperCase();

            html += `
                <div class="speaker-analysis-card">
                    <div class="speaker-analysis-header">
                        <div class="speaker-avatar" style="background: ${color}33; color: ${color}; border: 2px solid ${color}55;">${initials}</div>
                        <div>
                            <div class="speaker-analysis-name">${escapeHtml(name)}</div>
                            ${analysis.role_inference ? `<div style="font-size:0.75rem; color: var(--text-muted);">${escapeHtml(analysis.role_inference)}</div>` : ''}
                        </div>
                    </div>
                    <div class="speaker-metrics">
                        <div class="speaker-metric">
                            <div class="speaker-metric-label">Speaking Time</div>
                            <div class="speaker-metric-value">~${formatDuration(s.speakingTime || 0)}</div>
                        </div>
                        <div class="speaker-metric">
                            <div class="speaker-metric-label">Interventions</div>
                            <div class="speaker-metric-value">${s.interventions}</div>
                        </div>
                        <div class="speaker-metric">
                            <div class="speaker-metric-label">Words Spoken</div>
                            <div class="speaker-metric-value">${s.totalWords}</div>
                        </div>
                    </div>
                    ${(analysis.main_topics && analysis.main_topics.length > 0) ? `
                    <div class="speaker-topics">
                        <div class="speaker-topics-title">Main Topics</div>
                        <div class="topic-tags">
                            ${analysis.main_topics.map((t) => `<span class="topic-tag">${escapeHtml(t)}</span>`).join('')}
                        </div>
                    </div>` : ''}
                    ${(analysis.key_contributions && analysis.key_contributions.length > 0) ? `
                    <div class="speaker-topics" style="margin-top: var(--space-sm);">
                        <div class="speaker-topics-title">Key Contributions</div>
                        <ul style="list-style:none; display:flex; flex-direction:column; gap:4px;">
                            ${analysis.key_contributions.map((c) => `<li style="font-size:0.85rem; color:var(--text-secondary); padding-left:16px; position:relative;"><span style="position:absolute;left:0;color:${color};">•</span>${escapeHtml(c)}</li>`).join('')}
                        </ul>
                    </div>` : ''}
                </div>`;
        });

        html += `</div></div>`;

        // ── 10. Sentiment Analysis ─────────────────────────
        const sent = r.sentiment;
        const sentimentColor = {
            Positive: 'var(--green)', Neutral: 'var(--blue)',
            Negative: 'var(--red)', Mixed: 'var(--yellow)',
        };
        const sentimentBarColor = {
            Positive: '#10b981', Neutral: '#3b82f6',
            Negative: '#ef4444', Mixed: '#f59e0b',
        };
        const sentimentBarWidth = {
            Positive: '85%', Neutral: '50%',
            Negative: '30%', Mixed: '60%',
        };

        html += `
        <div class="output-section card">
            <div class="section-header">
                <div class="section-title-group">
                    <div class="section-icon card-icon yellow">💭</div>
                    <h2 class="section-title">Sentiment Analysis</h2>
                </div>
            </div>
            <div class="sentiment-grid">
                <div class="sentiment-card">
                    <div class="sentiment-label">Overall Sentiment</div>
                    <div class="sentiment-value" style="color: ${sentimentColor[sent.overall_sentiment] || 'var(--text-primary)'};">${escapeHtml(sent.overall_sentiment || 'N/A')}</div>
                    <div class="sentiment-bar"><div class="sentiment-bar-fill" style="width: ${sentimentBarWidth[sent.overall_sentiment] || '50%'}; background: ${sentimentBarColor[sent.overall_sentiment] || '#3b82f6'};"></div></div>
                </div>
                <div class="sentiment-card">
                    <div class="sentiment-label">Confidence</div>
                    <div class="sentiment-value" style="color: var(--text-heading);">${escapeHtml(sent.overall_confidence || 'N/A')}</div>
                </div>`;

        // Per-speaker sentiment
        if (sent.per_speaker) {
            Object.entries(sent.per_speaker).forEach(([name, data]) => {
                const sColor = sentimentColor[data.sentiment] || 'var(--text-primary)';
                html += `
                <div class="sentiment-card">
                    <div class="sentiment-label">${escapeHtml(name)}</div>
                    <div class="sentiment-value" style="color: ${sColor};">${escapeHtml(data.sentiment || 'N/A')}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted); margin-top:4px;">Confidence: ${escapeHtml(data.confidence || 'N/A')}</div>
                </div>`;
            });
        }

        html += `</div>`;

        // Agreement / Disagreement
        if ((sent.areas_of_agreement && sent.areas_of_agreement.length) || (sent.areas_of_disagreement && sent.areas_of_disagreement.length)) {
            html += `<div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); margin-top: var(--space-lg);">`;

            if (sent.areas_of_agreement && sent.areas_of_agreement.length) {
                html += `
                <div class="agreement-section">
                    <div class="agreement-title agree">✅ Areas of Agreement</div>
                    <ul class="agreement-list">
                        ${sent.areas_of_agreement.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
                    </ul>
                </div>`;
            }

            if (sent.areas_of_disagreement && sent.areas_of_disagreement.length) {
                html += `
                <div class="agreement-section">
                    <div class="agreement-title disagree">⚡ Areas of Disagreement</div>
                    <ul class="agreement-list">
                        ${sent.areas_of_disagreement.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
                    </ul>
                </div>`;
            }

            html += `</div>`;
        }

        html += `</div>`;

        DOM.outputContent.innerHTML = html;

        // ── Export Handlers ─────────────────────────────────
        const btnExport = document.getElementById('btn-export-md');
        const btnCopy = document.getElementById('btn-copy-all');

        if (btnExport) btnExport.addEventListener('click', () => downloadMarkdown(r));
        if (btnCopy) btnCopy.addEventListener('click', () => copyAllToClipboard(r));

        // Animate sentiment bars after render
        requestAnimationFrame(() => {
            document.querySelectorAll('.sentiment-bar-fill').forEach((bar) => {
                bar.style.width = bar.style.width; // trigger animation
            });
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  EXPORT
    // ═══════════════════════════════════════════════════════════
    function generateMarkdown(r) {
        let md = '';

        md += `# Meeting Information\n\n`;
        md += `- **Title:** ${r.metadata.title}\n`;
        md += `- **Date:** ${r.metadata.date}\n`;
        md += `- **Duration:** ${r.metadata.duration}\n`;
        md += `- **Language:** ${r.detectedLanguage}${r.wasTranslated ? ' → English (Translated)' : ''}\n`;
        md += `- **Total Speakers:** ${r.totalSpeakers}\n\n`;

        md += `# Speaker Statistics\n\n`;
        r.speakerOrder.forEach((name) => {
            const s = r.speakers[name];
            md += `- **${name}**: ${s.interventions} interventions, ~${formatDuration(s.speakingTime || 0)}, ${s.totalWords} words\n`;
        });
        md += `\n`;

        md += `# English Transcript\n\n`;
        r.transcript.forEach((seg) => {
            md += `[${seg.timestamp}]\n**${seg.speaker}:**\n${seg.text}\n\n`;
        });

        md += `# Executive Summary\n\n`;
        md += `## Meeting Purpose\n${r.summary.meeting_purpose || 'N/A'}\n\n`;
        md += `## Main Discussion Points\n`;
        (r.summary.main_discussion_points || []).forEach((p) => { md += `- ${p}\n`; });
        md += `\n## Next Steps\n`;
        (r.summary.next_steps || []).forEach((p) => { md += `- ${p}\n`; });
        md += `\n`;

        md += `# Key Decisions\n\n`;
        (r.summary.key_decisions || []).forEach((d) => { md += `- ${d}\n`; });
        md += `\n`;

        md += `# Action Items\n\n`;
        md += `| Task | Owner | Due Date | Priority |\n|------|-------|----------|----------|\n`;
        r.actionItems.forEach((item) => {
            md += `| ${item.task} | ${item.owner || 'Not Specified'} | ${item.due_date || 'Not Mentioned'} | ${item.priority || 'Medium'} |\n`;
        });
        md += `\n`;

        md += `# Risks & Concerns\n\n`;
        (r.summary.risks_or_issues || []).forEach((ri) => { md += `- ⚠️ ${ri}\n`; });
        md += `\n`;

        md += `# Open Questions\n\n`;
        (r.summary.open_questions || []).forEach((q) => { md += `- ❓ ${q}\n`; });
        md += `\n`;

        md += `# Speaker Analysis\n\n`;
        r.speakerOrder.forEach((name) => {
            const s = r.speakers[name];
            const analysis = r.speakerAnalysis[name] || {};
            md += `## ${name}\n`;
            if (analysis.role_inference) md += `**Role:** ${analysis.role_inference}\n`;
            md += `- Speaking Time: ~${formatDuration(s.speakingTime || 0)}\n`;
            md += `- Interventions: ${s.interventions}\n`;
            md += `- Words: ${s.totalWords}\n`;
            if (analysis.main_topics) md += `- Topics: ${analysis.main_topics.join(', ')}\n`;
            if (analysis.key_contributions) {
                md += `- Key Contributions:\n`;
                analysis.key_contributions.forEach((c) => { md += `  - ${c}\n`; });
            }
            md += `\n`;
        });

        md += `# Sentiment Analysis\n\n`;
        md += `- **Overall Sentiment:** ${r.sentiment.overall_sentiment || 'N/A'}\n`;
        md += `- **Confidence:** ${r.sentiment.overall_confidence || 'N/A'}\n\n`;
        md += `## Per-Speaker Sentiment\n`;
        if (r.sentiment.per_speaker) {
            Object.entries(r.sentiment.per_speaker).forEach(([name, data]) => {
                md += `- **${name}:** ${data.sentiment} (Confidence: ${data.confidence})\n`;
            });
        }
        md += `\n## Areas of Agreement\n`;
        (r.sentiment.areas_of_agreement || []).forEach((a) => { md += `- ${a}\n`; });
        md += `\n## Areas of Disagreement\n`;
        (r.sentiment.areas_of_disagreement || []).forEach((a) => { md += `- ${a}\n`; });

        return md;
    }

    function downloadMarkdown(r) {
        const md = generateMarkdown(r);
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `meeting-analysis-${r.metadata.date || 'export'}.md`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Markdown file downloaded!');
    }

    function copyAllToClipboard(r) {
        const md = generateMarkdown(r);
        navigator.clipboard.writeText(md).then(() => {
            showToast('Copied to clipboard!');
        }).catch(() => {
            showToast('Failed to copy to clipboard.', 'error');
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  SAMPLE DATA
    // ═══════════════════════════════════════════════════════════
    function loadSampleData() {
        DOM.meetingTitle.value = 'Q3 Product Sprint Planning';
        DOM.meetingDate.value = '2026-06-10';
        DOM.meetingDuration.value = '35 min';
        DOM.participants.value = 'SPEAKER_00=Sarah Chen, SPEAKER_01=Marcus Rivera, SPEAKER_02=Priya Sharma, SPEAKER_03=David Kim';
        DOM.languageSelect.value = 'english';

        DOM.transcriptInput.value = `[00:00:05] SPEAKER_00: Good morning everyone. Thanks for joining the Q3 sprint planning call. I know we have a lot to cover today, so let's jump right in. Marcus, can you start with the backend update?
[00:00:18] SPEAKER_01: Sure thing, Sarah. So um the API migration is about 70 percent complete. We've moved all the authentication endpoints to the new GraphQL layer. The remaining 30 percent is the reporting module and the data export endpoints. I'm estimating we'll need another two weeks to finish that.
[00:00:42] SPEAKER_00: Two weeks puts us right at the end of June. That's cutting it close for the Q3 launch. Are there any blockers we should be aware of?
[00:00:50] SPEAKER_01: Yeah actually there's one thing. The legacy database schema for the reporting module doesn't play well with the new ORM. David and I have been discussing two approaches. One is to write a migration script, and the other is to build an adapter layer. The migration script is cleaner but riskier. The adapter is safer but adds technical debt.
[00:01:15] SPEAKER_03: I'd recommend the adapter approach for now. We can schedule a proper migration in Q4 when we have more runway. The risk of a full migration during the launch window is too high.
[00:01:28] SPEAKER_00: I agree with David on that. Let's go with the adapter approach. Marcus, can you document the technical debt and create a ticket for the Q4 migration?
[00:01:38] SPEAKER_01: Absolutely, I'll have that documented by end of day tomorrow.
[00:01:45] SPEAKER_02: Before we move on, I wanted to flag something from the frontend side. We're seeing some performance issues with the new dashboard components. The data visualization widgets are rendering slowly when we have more than 10,000 data points. I've profiled it and the bottleneck is in the chart rendering library.
[00:02:08] SPEAKER_00: That's concerning. What's the impact on user experience?
[00:02:13] SPEAKER_02: Currently about a 3-second delay on initial load for enterprise customers with large datasets. It's not a dealbreaker but it's definitely noticeable. I have two proposals. First, we could implement virtual scrolling and lazy loading for the charts. Second, we could switch to a WebGL-based rendering library like deck.gl.
[00:02:38] SPEAKER_03: From a data engineering perspective, we could also implement server-side aggregation to reduce the data payload before it hits the frontend. That would help regardless of which rendering approach you choose.
[00:02:52] SPEAKER_02: That's a great idea, David. If we combine server-side aggregation with lazy loading, I think we can get the load time under 500 milliseconds.
[00:03:02] SPEAKER_00: Let's go with that combined approach. Priya, can you work with David on defining the aggregation API? I'd like to see a proof of concept by next Friday.
[00:03:15] SPEAKER_02: Yes, David and I can sync up after this meeting to scope it out.
[00:03:20] SPEAKER_03: Works for me. I'll block out time this afternoon for that.
[00:03:26] SPEAKER_00: Perfect. Now let's talk about the customer feedback from the beta program. We've received 47 responses so far. The overall sentiment is positive, with an NPS score of 72. However, there are three recurring themes in the feedback that we need to address.
[00:03:45] SPEAKER_00: First, users are asking for better keyboard shortcuts and accessibility features. Second, the onboarding flow is confusing for new users. Several people mentioned they didn't understand how to set up their first project. Third, there's a request for a dark mode, which honestly I thought we already had.
[00:04:08] SPEAKER_02: We have a dark mode toggle in settings, but it's buried three levels deep. I can move it to the top navigation bar this sprint. As for keyboard shortcuts, I've been maintaining a list of the most requested ones. I can implement the top 10 shortcuts in about three days.
[00:04:28] SPEAKER_00: Great, let's prioritize those. For the onboarding flow, I think we need a more structured approach. I'll schedule a separate design review session for that next week. Marcus, any concerns about backend support for the onboarding improvements?
[00:04:45] SPEAKER_01: No concerns. The onboarding API is already flexible enough. We just need the frontend to leverage the existing wizard endpoint.
[00:04:55] SPEAKER_00: Good. Let's also discuss timeline and milestones. Our Q3 launch target is August 15th. I'm proposing we set the following milestones: API migration complete by June 30th, performance optimization done by July 15th, beta 2 release by July 25th, and final QA by August 10th.
[00:05:20] SPEAKER_01: Those timelines work for the backend team, but I want to flag that we might need an additional QA engineer. Our current team is stretched thin with the migration work.
[00:05:32] SPEAKER_00: I'll bring that up with HR. Can you send me a job description or requirements by Thursday?
[00:05:38] SPEAKER_01: Will do.
[00:05:42] SPEAKER_03: One more thing. I've been monitoring our cloud infrastructure costs, and the new data pipeline is running about 20 percent over budget. The main driver is the real-time processing cluster. I think we should evaluate whether all metrics truly need real-time processing or if some can be batched.
[00:06:05] SPEAKER_00: That's a good point. David, can you prepare a cost analysis with recommendations? Let's review it at next week's meeting.
[00:06:14] SPEAKER_03: Absolutely. I'll have it ready by Monday.
[00:06:18] SPEAKER_00: Alright, I think we've covered everything. To summarize the key decisions: we're going with the adapter approach for the database migration, the combined aggregation plus lazy loading for performance, and prioritizing accessibility and dark mode visibility this sprint. Any final questions?
[00:06:38] SPEAKER_02: No questions from me. Clear plan.
[00:06:42] SPEAKER_01: All good here.
[00:06:44] SPEAKER_03: Same. Good meeting.
[00:06:47] SPEAKER_00: Great, thanks everyone. Let's execute. Have a good day.`;

        showToast('Sample data loaded!');
    }

    // ─── Clear ─────────────────────────────────────────────────
    function clearForm() {
        DOM.meetingTitle.value = '';
        DOM.meetingDate.value = '';
        DOM.meetingDuration.value = '';
        DOM.participants.value = '';
        DOM.languageSelect.value = 'auto';
        DOM.transcriptInput.value = '';
        DOM.outputEmpty.style.display = '';
        DOM.outputContent.style.display = 'none';
        DOM.outputContent.innerHTML = '';
        showToast('Form cleared.');
    }

    // ═══════════════════════════════════════════════════════════
    //  AUDIO UPLOAD & WHISPER TRANSCRIPTION
    // ═══════════════════════════════════════════════════════════

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function formatSecondsToTimestamp(totalSeconds) {
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = Math.floor(totalSeconds % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function handleFileSelect(file) {
        if (!file) return;

        // Validate file size (25 MB limit for Whisper API)
        const MAX_SIZE = 25 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            showToast(`File too large (${formatFileSize(file.size)}). Max 25 MB.`, 'error');
            return;
        }

        // Validate file type
        const validTypes = ['audio/', 'video/mp4', 'video/webm'];
        const validExts = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm', '.mp4'];
        const hasValidType = validTypes.some(t => file.type.startsWith(t));
        const hasValidExt = validExts.some(e => file.name.toLowerCase().endsWith(e));

        if (!hasValidType && !hasValidExt) {
            showToast('Unsupported file format. Use MP3, WAV, M4A, OGG, FLAC, WEBM, or MP4.', 'error');
            return;
        }

        selectedAudioFile = file;

        // Update UI
        DOM.uploadZone.style.display = 'none';
        DOM.uploadFileInfo.style.display = 'block';
        DOM.uploadFileName.textContent = file.name;
        DOM.uploadFileSize.textContent = formatFileSize(file.size);
        DOM.btnTranscribe.style.display = '';

        showToast(`File selected: ${file.name}`);
    }

    function removeFile() {
        selectedAudioFile = null;
        DOM.audioFileInput.value = '';
        DOM.uploadZone.style.display = '';
        DOM.uploadFileInfo.style.display = 'none';
        DOM.btnTranscribe.style.display = 'none';
        DOM.uploadProgressSection.style.display = 'none';
        DOM.uploadProgressBarFill.style.width = '0%';
    }

    async function transcribeAudio() {
        if (!selectedAudioFile) {
            showToast('No audio file selected.', 'error');
            return;
        }

        const apiKey = DOM.apiKey.value.trim();
        if (!apiKey) {
            showToast('Please enter your OpenAI API key first.', 'error');
            return;
        }

        // Show progress
        DOM.btnTranscribe.disabled = true;
        DOM.btnTranscribe.textContent = '⏳ Transcribing...';
        DOM.uploadProgressSection.style.display = 'block';
        DOM.uploadProgressLabel.textContent = '🎙️ Uploading and transcribing audio...';
        DOM.uploadProgressBarFill.style.width = '30%';

        try {
            // Call Whisper API
            const formData = new FormData();
            formData.append('file', selectedAudioFile);
            formData.append('model', 'whisper-1');
            formData.append('response_format', 'verbose_json');
            formData.append('timestamp_granularities[]', 'segment');

            DOM.uploadProgressBarFill.style.width = '50%';
            DOM.uploadProgressLabel.textContent = '🎙️ Sending to Whisper API...';

            const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: formData,
            });

            DOM.uploadProgressBarFill.style.width = '80%';
            DOM.uploadProgressLabel.textContent = '📝 Processing response...';

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error?.message || `Whisper API error: ${res.status}`);
            }

            const data = await res.json();

            DOM.uploadProgressBarFill.style.width = '90%';
            DOM.uploadProgressLabel.textContent = '✨ Formatting transcript...';

            // Format the response into our transcript format
            let transcriptText = '';

            if (data.segments && data.segments.length > 0) {
                // Use segment-level timestamps
                transcriptText = data.segments.map(seg => {
                    const timestamp = formatSecondsToTimestamp(seg.start);
                    const text = seg.text.trim();
                    return `[${timestamp}] SPEAKER_00: ${text}`;
                }).join('\n');
            } else if (data.text) {
                // Fallback: single block with no timestamps
                transcriptText = `[00:00:00] SPEAKER_00: ${data.text.trim()}`;
            }

            // Auto-fill the transcript textarea
            DOM.transcriptInput.value = transcriptText;

            // Auto-detect language from Whisper response
            if (data.language) {
                const langMap = {
                    'english': 'english', 'en': 'english',
                    'hindi': 'hindi', 'hi': 'hindi',
                };
                const detectedLang = langMap[data.language.toLowerCase()] || 'auto';
                DOM.languageSelect.value = detectedLang;
            }

            DOM.uploadProgressBarFill.style.width = '100%';
            DOM.uploadProgressLabel.textContent = '✅ Transcription complete!';

            showToast(`Transcription complete! ${data.segments?.length || 1} segments extracted.`);

            // Brief delay then hide progress
            setTimeout(() => {
                DOM.uploadProgressLabel.style.animation = 'none';
            }, 500);

        } catch (err) {
            DOM.uploadProgressLabel.textContent = '❌ Transcription failed';
            DOM.uploadProgressBarFill.style.width = '0%';
            showToast('Transcription error: ' + err.message, 'error');
            console.error('Whisper API error:', err);
        } finally {
            DOM.btnTranscribe.disabled = false;
            DOM.btnTranscribe.textContent = '🎙️ Transcribe with Whisper';
        }
    }

    // ─── Drag & Drop Handlers ──────────────────────────────────
    DOM.uploadZone.addEventListener('click', () => {
        DOM.audioFileInput.click();
    });

    DOM.audioFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    DOM.uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        DOM.uploadZone.classList.add('dragover');
    });

    DOM.uploadZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        DOM.uploadZone.classList.remove('dragover');
    });

    DOM.uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        DOM.uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    DOM.btnRemoveFile.addEventListener('click', removeFile);
    DOM.btnTranscribe.addEventListener('click', transcribeAudio);

    // ─── Event Listeners ───────────────────────────────────────
    DOM.btnProcess.addEventListener('click', processMeeting);
    DOM.btnSample.addEventListener('click', loadSampleData);
    DOM.btnSampleAlt.addEventListener('click', loadSampleData);
    DOM.btnClear.addEventListener('click', () => {
        clearForm();
        removeFile();
    });

    // Pre-fill API key
    DOM.apiKey.value = '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';

    // Set today's date as default
    DOM.meetingDate.value = new Date().toISOString().split('T')[0];

})();
