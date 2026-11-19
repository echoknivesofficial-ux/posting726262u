// =================================================
// SCAN ITEM — Camera + Gemini AI Analysis
// =================================================

const GEMINI_API_KEY = 'AQ.Ab8RN6IqvaGAEqiIW7jfDmNlkEXF9oWA2fRsxIBn8ZjX_-HaRQ';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

// DOM refs
const scanModal = $('scanModal');
const scanPanel = $('scanPanel');
const cameraZone = $('cameraZone');
const cameraInput = $('cameraInput');
const scanPreview = $('scanPreview');
const scanStep1 = $('scanStep1');
const scanStep2 = $('scanStep2');
const scanStep3 = $('scanStep3');
const scanError = $('scanError');
const scanStatus = $('scanStatus');
const scanSubStatus = $('scanSubStatus');
const resName = $('resName');
const resMaterial = $('resMaterial');
const resValue = $('resValue');
const resValueNote = $('resValueNote');

// ---------- Open / Close ----------
function openScan() {
  // Reset UI
  scanStep1.classList.remove('hidden');
  scanStep2.classList.add('hidden');
  scanStep3.classList.add('hidden');
  scanError.classList.add('hidden');
  scanPreview.classList.add('hidden');
  scanPreview.src = '';
  cameraInput.value = '';
  openModal(scanModal, scanPanel);
}

function closeScan() {
  closeModal(scanModal, scanPanel);
}

// ---------- Camera trigger ----------
cameraZone.addEventListener('click', () => cameraInput.click());

// ---------- Handle image ----------
cameraInput.addEventListener('change', async () => {
  const file = cameraInput.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    return toast('Please select an image file.', 'error');
  }
  if (file.size > 10 * 1024 * 1024) {
    return toast('Image too large (max 10MB).', 'error');
  }

  // Show preview
  const reader = new FileReader();
  reader.onload = (e) => {
    scanPreview.src = e.target.result;
    scanPreview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);

  // Transition to loading
  scanStep1.classList.add('hidden');
  scanStep2.classList.remove('hidden');
  scanError.classList.add('hidden');
  scanStatus.textContent = 'Analyzing item…';
  scanSubStatus.textContent = 'This takes 2–5 seconds';

  try {
    // Convert to base64
    const base64 = await fileToBase64(file);

    // Call Gemini
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: `Analyze this clothing/fashion item photo. Return ONLY a JSON object with these exact keys, no markdown, no explanation:
{
  "item": "specific product name (e.g., 'Carhartt Detroit Jacket', 'Nike Air Force 1', 'Levi's 501 Jeans')",
  "material": "primary material composition (e.g., 'cotton canvas', 'full-grain leather', '100% polyester')",
  "category": "one of: Sneakers, Apparel, Accessories",
  "estimatedValue": "approximate resale price in PHP (e.g., '₱1,200 – ₱1,800')",
  "condition": "visible condition assessment (e.g., 'Good', 'Like New', 'Worn')"
}`
            },
            {
              inline_data: {
                mime_type: file.type,
                data: base64
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 300
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error ${response.status}: ${errText.slice(0, 100)}`);
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!rawText) {
      throw new Error('Empty response from AI');
    }

    // Parse JSON from response
    let result;
    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      result = match ? JSON.parse(match[0]) : { item: rawText, material: 'Unknown', category: '—', estimatedValue: '—', condition: '—' };
    } catch {
      result = { item: rawText, material: 'Unknown', category: '—', estimatedValue: '—', condition: '—' };
    }

    // Show results
    scanStep2.classList.add('hidden');
    scanStep3.classList.remove('hidden');

    resName.textContent = result.item || 'Unknown item';
    resMaterial.textContent = result.material || 'Could not determine';
    resValue.textContent = result.estimatedValue || '—';
    resValueNote.textContent = `${result.category || '—'} · Condition: ${result.condition || '—'}`;

  } catch (err) {
    console.error('[SW627 Scan]', err);
    scanStep2.classList.add('hidden');
    scanError.classList.remove('hidden');
    scanError.innerHTML = `
      <i class="fas fa-exclamation-triangle text-2xl text-red-400 mb-2"></i>
      <p class="text-xs text-red-400">${escapeHtml(err.message || 'Analysis failed. Try again.')}</p>
    `;
    toast('Scan failed: ' + (err.message || 'Unknown error'), 'error');
  }
});

// ---------- Helpers ----------
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Scan again ----------
$('scanAgainBtn').addEventListener('click', () => {
  openScan();
});

// ---------- Wire up buttons ----------
$('scanBtn')?.addEventListener('click', openScan);
$('mobileScanBtn')?.addEventListener('click', openScan);
$('closeScan').addEventListener('click', closeScan);
$('scanOverlay').addEventListener('click', closeScan);

// ---------- Keyboard shortcut: Ctrl/Cmd + Shift + S ----------
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    openScan();
  }
});
