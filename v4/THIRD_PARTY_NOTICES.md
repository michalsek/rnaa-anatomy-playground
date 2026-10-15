# Third-party notices

## BoneTideOSS

Parts of this workspace's skeleton are adapted from
[reczkok/BoneTideOSS](https://github.com/reczkok/BoneTideOSS) (MIT):

- the pnpm monorepo layout and the `#platform/*` seam (engine reaches the host only through
  `#platform/*`, remapped by Metro `resolveRequest`; `package.json#imports` for Node tests);
- Metro + Babel config with `unplugin-typegpu/babel`;
- GPU device init requesting the `'implicit-device-synchronization'` feature;
- the `onLayout` → configure context → rAF + `context.present?.()` shell;
- the `TextDecoder` polyfill and the iOS UIScene lifecycle config plugin.

Adapted files carry a short header comment naming the source. No game code was copied.

```
MIT License

Copyright (c) 2026 Konrad Reczko

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
