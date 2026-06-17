/* Web Worker: runs the (synchronous, long) build optimizer off the main thread
   so the page stays responsive. Posts {type:'progress'} updates during the run
   and {type:'done'} with the full result. All payloads are plain data
   (layouts are {tool,x,y,dir}), so they structured-clone cleanly. */
import { optimize } from './optimize.js';

self.onmessage = (e) => {
  const opts = e.data || {};
  try {
    const res = optimize({ ...opts, onProgress: (info) => self.postMessage({ type: 'progress', info }) });
    self.postMessage({ type: 'done', res });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
