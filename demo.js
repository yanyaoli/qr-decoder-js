import { decodeQRFile } from './dist/esm/index.js';

const fileInput = document.querySelector('#file-input');
const dropZone = document.querySelector('#drop-zone');
const urlForm = document.querySelector('#url-form');
const urlInput = document.querySelector('#image-url');
const preview = document.querySelector('#preview');
const placeholder = document.querySelector('#preview-placeholder');
const status = document.querySelector('#status');
const output = document.querySelector('#output');
const meta = document.querySelector('#meta');
const copyButton = document.querySelector('#copy');
let previewUrl = null;
let requestId = 0;
let requestController = null;

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function beginRequest() {
  requestController?.abort();
  requestController = new AbortController();
  requestId += 1;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  preview.removeAttribute('src');
  preview.hidden = true;
  placeholder.hidden = false;
  output.textContent = 'Decoded content will appear here.';
  output.classList.add('empty');
  meta.textContent = '';
  copyButton.hidden = true;
  return { id: requestId, signal: requestController.signal };
}

async function decodeImage(blob, id, requireImageType = true) {
  if (requireImageType && !blob.type.startsWith('image/')) throw new Error('Please choose a valid image file.');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  preview.src = previewUrl;
  preview.hidden = false;
  placeholder.hidden = true;
  setStatus('Decoding…');
  // Let the browser paint the preview before the synchronous decoding work starts.
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  if (id !== requestId) return;
  const start = performance.now();
  const result = await decodeQRFile(blob);
  if (id !== requestId) return;
  if (!result.success) {
    setStatus('No QR code found. Try a clearer image.', true);
    return;
  }
  setStatus('Decoded successfully');
  output.textContent = result.text ?? '';
  output.classList.remove('empty');
  meta.textContent = `Time: ${Math.round(performance.now() - start)} ms · Encoding: ${result.encoding || 'Unknown'}`;
  copyButton.hidden = false;
}

async function handleFile(file) {
  if (!file) return;
  const { id } = beginRequest();
  try {
    await decodeImage(file, id);
  } catch (error) {
    if (id === requestId) setStatus(error instanceof Error ? error.message : 'Could not read the image.', true);
  }
}

async function handleUrl(value) {
  const { id, signal } = beginRequest();
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Enter an HTTP or HTTPS image URL.');
    setStatus('Loading image…');
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Could not load the image (HTTP ${response.status}).`);
    const blob = await response.blob();
    if (id === requestId) await decodeImage(blob, id, false);
  } catch (error) {
    if (id !== requestId || error?.name === 'AbortError') return;
    setStatus(error instanceof TypeError ? 'Could not load the image. Check the URL and cross-origin settings.' : error.message, true);
  }
}

fileInput.addEventListener('change', () => {
  handleFile(fileInput.files?.[0]);
  fileInput.value = '';
});
urlForm.addEventListener('submit', event => {
  event.preventDefault();
  handleUrl(urlInput.value.trim());
});
document.addEventListener('paste', event => {
  const file = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'))?.getAsFile();
  if (file) {
    event.preventDefault();
    handleFile(file);
  }
});
for (const name of ['dragenter', 'dragover']) dropZone.addEventListener(name, event => {
  event.preventDefault();
  dropZone.classList.add('dragging');
});
for (const name of ['dragleave', 'drop']) dropZone.addEventListener(name, event => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
});
dropZone.addEventListener('drop', event => handleFile(event.dataTransfer?.files?.[0]));
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.textContent);
    copyButton.textContent = 'Copied';
    setTimeout(() => { copyButton.textContent = 'Copy'; }, 1500);
  } catch {
    setStatus('Could not copy. Select the content to copy it manually.', true);
  }
});
window.addEventListener('pagehide', () => { if (previewUrl) URL.revokeObjectURL(previewUrl); });
