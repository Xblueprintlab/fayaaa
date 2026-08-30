import appleLogoUrl from "./assets/apple-logo.svg";

export function mountPlayground(routePreviewUrl = "/sample-fire.png"): "image" {
  document.body.innerHTML = `
    <div class="playground-layout">
      <aside class="control-rail" aria-label="Fayaaa controls">
        <header class="rail-header">
          <a class="brand-mark" href="/" aria-label="Reload Fayaaa">
            <img src="/fayaaa-mark.png" alt="" width="38" height="42" />
          </a>
        </header>
        <div class="dialkit-mount" id="dialkit-root"></div>
        <footer class="rail-footer">
          <div class="footer-maker">
            <span class="footer-avatar" aria-hidden="true">
              <img src="/nabil-bakour-avatar.png" alt="" />
            </span>
            <span>Crafted by <a class="footer-name" href="https://nabilbakour.com/" target="_blank" rel="noreferrer"><strong>Nabil Bakour</strong></a></span>
          </div>
          <nav class="footer-links" aria-label="Maker and project links">
            <a class="footer-x" href="https://twitter.com/0nabilbk" target="_blank" rel="noreferrer" aria-label="Nabil on X">𝕏</a>
            <span class="footer-dot" aria-hidden="true">·</span>
            <a class="footer-github" href="https://github.com/Xblueprintlab/fayaaa" target="_blank" rel="noreferrer" aria-label="View Fayaaa on GitHub">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18.2.1 15 1.8a13.4 13.4 0 0 0-6 0C5.8.1 4.7.5 4.7.5A5 5 0 0 0 4.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.4 3.5 6.6 6.8 7A4.8 4.8 0 0 0 9 18v4m0-3c-5 .9-5-2.5-7-3" />
              </svg>
            </a>
          </nav>
        </footer>
      </aside>

      <main class="stage-area">
        <section class="demo-shell" id="demo-shell" data-mode="image" data-blend="normal">
          <div
            class="shader-stage"
            id="shader-stage"
            role="region"
            aria-label="Live Fayaaa fire preview"
            tabindex="0"
          >
          <div class="preview-toolbar" aria-label="Composition controls">
          <div class="composition-controls">
            <div class="toolbar-menu subject-menu" data-toolbar-menu data-subject-picker>
              <button class="toolbar-trigger" type="button" aria-label="Choose subject" aria-expanded="false">
                <span class="toolbar-thumbnail" aria-hidden="true">
                  <img id="toolbar-source-thumbnail" alt="" />
                </span>
                <span class="toolbar-copy">
                  <strong id="subject-mode-label">Image</strong>
                </span>
              </button>
              <div class="toolbar-popover" hidden>
                <div class="toolbar-segment" aria-label="Subject type">
                  <button class="is-active" type="button" data-subject-tab="image">Image</button>
                  <button type="button" data-subject-tab="text">Text</button>
                </div>
                <div class="toolbar-panel" data-subject-panel="image">
                  <div class="subject-samples" role="group" aria-label="Sample subjects">
                    <button class="subject-sample is-active" type="button" data-sample-source="${appleLogoUrl}" data-sample-name="Apple" aria-label="Use Apple sample" aria-pressed="true">
                      <img src="${appleLogoUrl}" alt="" />
                    </button>
                    <button class="subject-sample" type="button" data-sample-source="/fayaaa-mark.png" data-sample-name="Flame" aria-label="Use Flame sample" aria-pressed="false">
                      <img src="/fayaaa-mark.png" alt="" />
                    </button>
                    <button class="subject-sample" type="button" data-sample-source="/sample-leaf-photo.png" data-sample-name="Leaf photo" data-burn-around="true" aria-label="Use leaf photo sample" aria-pressed="false">
                      <img src="/sample-leaf-photo.png" alt="" />
                    </button>
                    <button class="subject-sample" type="button" data-sample-source="/artifact-mark.svg" data-sample-name="Artifact" aria-label="Use Artifact sample" aria-pressed="false">
                      <img src="/artifact-mark.svg" alt="" />
                    </button>
                  </div>
                  <button class="subject-upload-dropzone" type="button" data-upload>
                    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none">
                      <path d="M10 13V4m0 0L6.75 7.25M10 4l3.25 3.25M4 12.5v2A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-2" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    <span><strong>Upload image</strong><small>PNG, JPG, SVG or WebP</small></span>
                  </button>
                </div>
              </div>
            </div>

            <div class="toolbar-menu background-menu" data-toolbar-menu data-background-picker>
              <button class="toolbar-trigger" type="button" aria-label="Choose background" aria-expanded="false">
                <span class="background-swatch" id="background-swatch" aria-hidden="true"></span>
                <span class="toolbar-copy">
                  <strong id="background-mode-label">Background</strong>
                </span>
              </button>
              <div class="toolbar-popover" hidden>
                <div class="toolbar-segment toolbar-segment-three" aria-label="Background type">
                  <button class="is-active" type="button" data-background-mode="color">Color</button>
                  <button type="button" data-background-mode="image">Image</button>
                  <button type="button" data-background-mode="transparent">Clear</button>
                </div>
                <div class="toolbar-panel" data-background-panel="color">
                  <div class="background-color-options" role="group" aria-label="Canvas color">
                    <button class="background-color-choice" type="button" data-background-color="#180e01" aria-label="Ember black" aria-pressed="true" style="--choice-color: #180e01"></button>
                    <button class="background-color-choice" type="button" data-background-color="#f2eee7" aria-label="Warm white" aria-pressed="false" style="--choice-color: #f2eee7"></button>
                    <button class="background-color-choice" type="button" data-background-color="#5751ed" aria-label="Violet" aria-pressed="false" style="--choice-color: #5751ed"></button>
                    <button class="background-color-choice" type="button" data-background-color="#ff5a1f" aria-label="Orange" aria-pressed="false" style="--choice-color: #ff5a1f"></button>
                    <button class="background-color-choice" type="button" data-background-color="#a7ead5" aria-label="Mint" aria-pressed="false" style="--choice-color: #a7ead5"></button>
                    <button class="background-color-custom" id="background-color-custom" type="button" aria-label="Choose a custom canvas color" aria-pressed="false">
                      <span aria-hidden="true"></span>
                      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
                        <path d="m4.5 6 3.5 3.5L11.5 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </button>
                    <input id="background-color" class="background-color-native" type="color" value="#180e01" tabindex="-1" aria-hidden="true" />
                    <output id="background-color-value" hidden>#180e01</output>
                  </div>
                </div>
                <div class="toolbar-panel" data-background-panel="image" hidden>
                  <button class="toolbar-action" type="button" data-upload-background>
                    Upload background
                  </button>
                  <span class="toolbar-file-name" id="background-file-name">No image selected</span>
                </div>
                <div class="toolbar-panel toolbar-panel-note" data-background-panel="transparent" hidden>
                  PNG downloads keep the background transparent.
                </div>
              </div>
            </div>

            <div class="toolbar-menu fire-menu" data-toolbar-menu data-fire-picker>
              <button class="toolbar-trigger" type="button" aria-label="Choose fire colors" aria-expanded="false">
                <span class="fire-swatch" id="fire-swatch" aria-hidden="true"></span>
                <span class="toolbar-copy"><strong>Fire</strong></span>
              </button>
              <div class="toolbar-popover fire-popover" hidden>
                <div class="toolbar-palettes-shell" id="toolbar-palette-root"></div>
              </div>
            </div>
          </div>

          <div class="download-control" data-toolbar-menu data-download-picker>
            <button class="download-trigger" type="button" aria-label="Choose download format" aria-expanded="false">
              <span>Download</span>
            </button>
            <div class="download-options" hidden>
              <button class="download-option" type="button" data-export-frame>
                Download image
              </button>
              <button class="download-option" type="button" data-record-clip>
                Download video
              </button>
            </div>
          </div>
          </div>
            <img class="static-preview" src="${routePreviewUrl}" alt="" aria-hidden="true" />
            <img class="background-preview" id="background-preview" alt="" aria-hidden="true" hidden />
            <img class="source-preview" id="source-preview" alt="" aria-hidden="true" />
            <canvas id="playground" aria-label="Live Fayaaa fire preview"></canvas>

            <button
              class="stage-sound-toggle"
              id="sound-toggle"
              type="button"
              aria-pressed="false"
              aria-label="Turn fire sound on"
              title="Fire sound"
            >
              <svg class="sound-icon sound-icon-off" viewBox="0 0 24 24" aria-hidden="true" fill="none">
                <path d="M10.1568 3.4644C11.3026 2.54773 13 3.36353 13 4.83092V19.1696C13 20.637 11.3026 21.4528 10.1568 20.5361L6.07931 17.2742C5.85767 17.0969 5.58228 17.0003 5.29844 17.0003H3.75C2.23122 17.0003 1 15.769 1 14.2503V9.75029C1 8.23151 2.23122 7.00029 3.75 7.00029H5.29844C5.58228 7.00029 5.85767 6.90369 6.07931 6.72638L10.1568 3.4644Z" fill="currentColor" />
                <path d="M22.0303 10.5303C22.3232 10.2374 22.3232 9.76257 22.0303 9.46968C21.7374 9.17678 21.2625 9.17678 20.9697 9.46968L19.3787 11.0607L17.7877 9.46968C17.4948 9.17678 17.0199 9.17678 16.727 9.46968C16.4341 9.76257 16.4341 10.2374 16.727 10.5303L18.318 12.1213L16.727 13.7123C16.4341 14.0052 16.4341 14.4801 16.727 14.773C17.0199 15.0659 17.4948 15.0659 17.7877 14.773L19.3787 13.182L20.9697 14.773C21.2625 15.0659 21.7374 15.0659 22.0303 14.773C22.3232 14.4801 22.3232 14.0052 22.0303 13.7123L20.4393 12.1213L22.0303 10.5303Z" fill="currentColor" />
              </svg>
              <svg class="sound-icon sound-icon-on" viewBox="0 0 24 24" aria-hidden="true" fill="none">
                <path d="M13 4.83092C13 3.36353 11.3026 2.54773 10.1568 3.4644L6.07931 6.72638C5.85767 6.90369 5.58228 7.00029 5.29844 7.00029H3.75C2.23122 7.00029 1 8.23151 1 9.75029V14.2503C1 15.769 2.23122 17.0003 3.75 17.0003H5.29844C5.58228 17.0003 5.85767 17.0969 6.07931 17.2742L10.1568 20.5361C11.3026 21.4528 13 20.637 13 19.1696V4.83092Z" fill="currentColor" />
                <path d="M18.7175 4.22162C19.0104 3.92873 19.4852 3.92873 19.7781 4.22162C21.7679 6.21141 23 8.96244 23 11.9998C23 15.0372 21.7679 17.7882 19.7781 19.778C19.4852 20.0709 19.0104 20.0709 18.7175 19.778C18.4246 19.4851 18.4246 19.0102 18.7175 18.7173C20.4375 16.9973 21.5 14.6234 21.5 11.9998C21.5 9.37624 20.4375 7.00227 18.7175 5.28228C18.4246 4.98939 18.4246 4.51452 18.7175 4.22162Z" fill="currentColor" />
                <path d="M16.4195 7.581C16.1266 7.28811 15.6517 7.28811 15.3588 7.581C15.0659 7.87389 15.0659 8.34876 15.3588 8.64166C16.2192 9.50206 16.7501 10.6885 16.7501 12.0004C16.7501 13.3123 16.2192 14.4988 15.3588 15.3592C15.0659 15.6521 15.0659 16.1269 15.3588 16.4198C15.6517 16.7127 16.1266 16.7127 16.4195 16.4198C17.5497 15.2896 18.2501 13.7261 18.2501 12.0004C18.2501 10.2747 17.5497 8.7112 16.4195 7.581Z" fill="currentColor" />
              </svg>
            </button>

            <button
              class="stage-replay-intro"
              id="replay-intro"
              type="button"
              aria-label="Replay the intro animation"
              title="Replay intro"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
                <path d="M3 4.5V10h5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M3.8 14.2a8.5 8.5 0 1 0 .7-6.6L3 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>

            <button
              class="stage-text-hitarea"
              id="stage-text-hitarea"
              type="button"
              data-edit-text
              aria-label="Edit text in playground"
              hidden
            ></button>
            <input
              class="stage-text-editor"
              id="stage-text-editor"
              type="text"
              value="Fayaaa"
              maxlength="40"
              autocomplete="off"
              spellcheck="false"
              aria-label="Edit subject text directly"
              hidden
            />

            <div class="stage-drop" id="drop-hint" role="status" aria-hidden="true" hidden>
              <strong>Drop your image</strong>
              <span>PNG, JPG, SVG, or WebP</span>
            </div>
            <div class="stage-unavailable" aria-hidden="true">
              <strong>WebGPU is required for the live shader.</strong>
              <span>Open Fayaaa in a current WebGPU browser.</span>
            </div>
          </div>
        </section>
      </main>
    </div>

    <div class="video-export-modal" id="video-export-modal" role="dialog" aria-modal="true" aria-labelledby="video-export-title" hidden>
      <div class="video-export-dialog">
        <header class="video-export-header">
          <h2 id="video-export-title">Export video</h2>
          <button class="video-export-close" type="button" aria-label="Close video export">×</button>
        </header>
        <div class="video-export-layout">
          <div class="video-frame-wrap">
            <canvas class="video-frame-preview" id="video-frame-preview" aria-label="Video framing preview"></canvas>
            <span class="video-frame-hint">Drag to frame</span>
          </div>
          <div class="video-export-settings">
            <fieldset>
              <legend>Ratio</legend>
              <div class="video-option-group" data-video-options="ratio">
                <button type="button" data-video-ratio="16:9" aria-pressed="true">16:9</button>
                <button type="button" data-video-ratio="1:1" aria-pressed="false">1:1</button>
                <button type="button" data-video-ratio="9:16" aria-pressed="false">9:16</button>
              </div>
            </fieldset>
            <fieldset>
              <legend>Frame rate</legend>
              <div class="video-option-group" data-video-options="fps">
                <button type="button" data-video-fps="24" aria-pressed="false">24 FPS</button>
                <button type="button" data-video-fps="30" aria-pressed="true">30 FPS</button>
                <button type="button" data-video-fps="60" aria-pressed="false">60 FPS</button>
              </div>
            </fieldset>
            <fieldset>
              <legend>Quality</legend>
              <div class="video-quality-group" data-video-options="quality">
                <button type="button" data-video-quality="standard" aria-pressed="false"><strong>Standard</strong><span>720p · 6 Mbps</span></button>
                <button type="button" data-video-quality="high" aria-pressed="true"><strong>High</strong><span>1080p · 12 Mbps</span></button>
                <button type="button" data-video-quality="max" aria-pressed="false"><strong>Max</strong><span>1440p · 24 Mbps</span></button>
              </div>
            </fieldset>
          </div>
        </div>
        <footer class="video-export-footer">
          <output id="video-export-summary">1920 × 1080 · 30 FPS</output>
          <div>
            <button class="video-export-cancel" type="button">Cancel</button>
            <button class="video-export-confirm" type="button">Export video</button>
          </div>
        </footer>
      </div>
    </div>

    <div class="engine-controls" hidden aria-hidden="true">
      <span id="gpu-status">starting WebGPU…</span>
      <span id="source-name">sample image</span>
      <span id="stage-note"></span>
      <p id="mode-description"></p>
      <p id="export-status" role="status">Ready to export.</p>
      <button id="compare-source" type="button" aria-pressed="false">Show source</button>
      <button id="motion-toggle" type="button" aria-pressed="true">Pause</button>
      <button id="clear-image" type="button">Reset image</button>
      <button id="export" type="button">Export PNG</button>
      <button id="reset" type="button">Reset Fire</button>
      <button id="copy-json" type="button">Copy settings</button>
      <select id="preset" aria-label="Apply a color palette">
        <option value="fire">Fire colors</option>
        <option value="plasma">Violet colors</option>
        <option value="ghost">Mint colors</option>
        <option value="custom" disabled hidden>Custom colors</option>
      </select>
      <select id="blend-mode">
        <option value="screen">screen</option>
        <option value="overlay">overlay</option>
        <option value="multiply">multiply</option>
        <option value="normal">normal</option>
      </select>
      <output id="angle-value">0°</output>
      <span data-png-note></span>
      <span data-record-note></span>
    </div>

    <input id="file" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden />
    <input
      id="background-file"
      type="file"
      accept="image/png,image/jpeg,image/svg+xml,image/webp"
      hidden
    />
    <p class="sr-status" id="sr-status" aria-live="polite"></p>
  `;
  return "image";
}
