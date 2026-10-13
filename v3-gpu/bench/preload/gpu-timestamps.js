// GPU pages: turn on GPU timestamp queries (notes/GPU-API.md `?gpuTime`) so __gpu.frameStats().live.ms.gpu reports the
// GPU pass. Off by default since M5 (each measured frame costs an extra pass and two submits): only GPU-pass rows use it.
window.__gpuTimestamps = true;
