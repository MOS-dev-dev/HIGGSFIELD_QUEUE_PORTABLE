import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { URL } from 'url';

/**
 * Helper delay function
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Chuyển đổi đường dẫn file container sang đường dẫn Windows host cho Chrome CDP
 */
export function resolveToHostPath(filePath) {
    if (!filePath || typeof filePath !== 'string') return filePath;
    const cleanPath = filePath.trim();
    const hostUploads = process.env.HOST_UPLOADS_DIR || path.join(process.cwd(), 'uploads');

    // Nếu chạy trong container Docker: /app/uploads/xxx
    if (cleanPath.startsWith('/app/uploads/') || cleanPath.startsWith('/app/uploads\\')) {
        const basename = path.basename(cleanPath);
        return path.win32.join(hostUploads, basename);
    }
    // Nếu là đường dẫn tương đối uploads/xxx
    if (cleanPath.startsWith('uploads/') || cleanPath.startsWith('uploads\\') || cleanPath.startsWith('./uploads')) {
        const basename = path.basename(cleanPath);
        return path.win32.join(hostUploads, basename);
    }
    return cleanPath;
}

/**
 * Làm sạch prompt:
 * 1. Mặc kệ xuống dòng (chuyển \r, \n thành khoảng trắng để prompt dài không bị ngắt)
 * 2. Tự động loại bỏ tất cả ký tự đặc biệt TRỪ các ký tự: ( ) , @ " .
 */
export function sanitizePrompt(text) {
    if (!text || typeof text !== 'string') return '';
    // Chuyển tất cả dấu xuống dòng thành dấu cách
    let cleaned = text.replace(/[\r\n]+/g, ' ');
    // Giữ chữ cái (\p{L}), số (\p{N}), khoảng trắng (\s), và các ký tự: ( ) , @ " .
    cleaned = cleaned.replace(/[^\p{L}\p{N}\s(),@".]/gu, '');
    // Chuẩn hóa khoảng trắng liên tiếp và trim
    return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Thiết lập Duration bằng cách điều khiển thanh trượt Radix Slider trong popover "Choose duration".
 * Hỗ trợ các mốc từ 4s đến 30s.
 */
async function trySetDuration(page, targetSec, onLog = () => {}) {
    if (!targetSec || targetSec <= 0) return false;
    try {
        // 1. Kiểm tra popover đã mở chưa hoặc click nút Duration để mở popover
        const btnStatus = await page.evaluate(() => {
            const layout = document.querySelector('#video-create-layout') || document;
            const durBtn = layout.querySelector('button[aria-label="Duration"]') || 
                           Array.from(layout.querySelectorAll('button')).find(b => (b.innerText || '').trim().match(/^\d+s$/i));
            if (!durBtn) return { error: 'Không tìm thấy nút Duration trên form' };

            let popover = document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]');
            if (!popover || popover.getAttribute('data-state') === 'closed') {
                durBtn.click();
            }
            return { opened: true, currentText: durBtn.innerText.trim() };
        });

        if (btnStatus.error) {
            onLog(`⚠️ ${btnStatus.error}. Bỏ qua set Duration.`);
            return false;
        }

        await sleep(600);

        // 2. Tìm slider trong Popover và lấy thông số min, max, track bounding box
        const sliderInfo = await page.evaluate(() => {
            const popover = document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]') || document.querySelector('[role="dialog"]');
            if (!popover) return { error: 'Popover Choose duration không mở' };

            const sliderThumb = popover.querySelector('[role="slider"]');
            if (!sliderThumb) return { error: 'Không tìm thấy thanh trượt Slider trong Popover' };

            const track = sliderThumb.closest('span[data-orientation="horizontal"]') || sliderThumb.parentElement?.parentElement;
            const thumbRect = sliderThumb.getBoundingClientRect();
            const trackRect = track ? track.getBoundingClientRect() : thumbRect;

            const min = parseInt(sliderThumb.getAttribute('aria-valuemin') || '4', 10);
            const max = parseInt(sliderThumb.getAttribute('aria-valuemax') || '30', 10);
            const now = parseInt(sliderThumb.getAttribute('aria-valuenow') || `${min}`, 10);

            sliderThumb.focus();

            return {
                min,
                max,
                now,
                thumbRect: { x: thumbRect.x, y: thumbRect.y, w: thumbRect.width, h: thumbRect.height },
                trackRect: { x: trackRect.x, y: trackRect.y, w: trackRect.width, h: trackRect.height }
            };
        });

        if (sliderInfo.error) {
            onLog(`⚠️ ${sliderInfo.error}. Bỏ qua.`);
            return false;
        }

        const { min, max, trackRect } = sliderInfo;
        const clamped = Math.max(min, Math.min(max, targetSec));

        // 3. Click chuột vào đúng vị trí tỷ lệ trên Slider Track
        const pct = (clamped - min) / (max - min);
        const clickX = trackRect.x + pct * trackRect.w;
        const clickY = trackRect.y + trackRect.h / 2;

        await page.mouse.click(clickX, clickY);
        await sleep(200);

        // 4. Kiểm tra và tinh chỉnh bằng phím Home + ArrowRight nếu cần
        const checkVal = await page.evaluate(() => {
            const sliderThumb = document.querySelector('[role="dialog"] [role="slider"], [data-radix-popper-content-wrapper] [role="slider"]');
            return sliderThumb ? parseInt(sliderThumb.getAttribute('aria-valuenow') || '0', 10) : null;
        });

        if (checkVal !== null && checkVal !== clamped) {
            await page.keyboard.press('Home');
            await sleep(50);
            const steps = clamped - min;
            for (let i = 0; i < steps; i++) {
                await page.keyboard.press('ArrowRight');
            }
            await sleep(100);
        }

        // 5. Đóng popover
        await page.keyboard.press('Escape');
        await sleep(400);

        const finalStatus = await page.evaluate(() => {
            const layout = document.querySelector('#video-create-layout') || document;
            const durBtn = layout.querySelector('button[aria-label="Duration"]') || 
                           Array.from(layout.querySelectorAll('button')).find(b => (b.innerText || '').trim().match(/^\d+s$/i));
            return durBtn ? durBtn.innerText.trim() : null;
        });

        onLog(`✅ Đã thiết lập Duration: ${finalStatus || `${clamped}s`} (Slider: ${min}s - ${max}s).`);
        return true;
    } catch (e) {
        onLog(`⚠️ Lỗi khi chỉnh Duration: ${e.message}`);
        return false;
    }
}

/**
 * Ép giao diện về chế độ "References" (KHÔNG phải Extend Video) và đóng mọi overlay/modal
 * đang mở. Điều này cực kỳ quan trọng: sau bước upload tham chiếu, Higgsfield thường
 * tự động chuyển sang "Extend Video" mode -> làm tắt Unlimited Mode. Phải ép về lại
/**
 * Đảm bảo cửa sổ Chrome CDP luôn luôn được mở rộng phóng to toàn màn hình (Maximized).
 * Tự động xóa sạch mọi device metrics override / scale / zoom nhân tạo để giao diện hiển thị 100% full screen gốc.
 */
async function ensureBrowserMaximized(page, browser, onLog = () => {}) {
    try {
        if (page && !page.isClosed()) {
            // Xóa bỏ hoàn toàn device metrics override và page scale factor để giao diện giãn 100% toàn màn hình gốc
            try {
                const client = await page.target().createCDPSession();
                await client.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
                await client.send('Emulation.resetPageScaleFactor').catch(() => {});
                await client.detach().catch(() => {});
            } catch (e) {}

            await page.evaluate(() => {
                document.documentElement.style.zoom = '';
                document.body.style.zoom = '';
            }).catch(() => {});
            await page.bringToFront().catch(() => {});
        }
        if (browser) {
            const targets = browser.targets();
            const pageTarget = targets.find((t) => t.type() === 'page');
            if (pageTarget) {
                const cdp = await pageTarget.createCDPSession();
                try {
                    const { windowId } = await cdp.send('Browser.getWindowForTarget');
                    if (windowId) {
                        const boundsRes = await cdp.send('Browser.getWindowBounds', { windowId }).catch(() => null);
                        const state = boundsRes?.bounds?.windowState;
                        if (state === 'minimized' || state === 'normal') {
                            await cdp.send('Browser.setWindowBounds', {
                                windowId,
                                bounds: { windowState: 'maximized' }
                            });
                            onLog('🖥️ [CHỐNG THU NHỎ] Đã tự động khôi phục và phóng to toàn màn hình Chrome (Maximized).');
                        }
                    }
                } catch (err) {
                } finally {
                    try { await cdp.detach(); } catch (e) {}
                }
            }
        }
    } catch (e) {}
}

/**
 * Ép giao diện về chế độ "References" (KHÔNG phải Extend Video) và đóng mọi overlay/modal
 * đang mở. Điều này cực kỳ quan trọng: sau bước upload tham chiếu, Higgsfield thường
 * tự động chuyển sang "Extend Video" mode -> làm tắt Unlimited Mode. Phải ép về lại
 * References trước khi thao tác công tắc Unlimited / bấm Generate.
 */
async function ensureReferencesMode(page, onLog = () => {}) {
    // 1. Đóng mọi dialog/modal/popover đang mở (assets-picker, upload dialog...)
    await page.evaluate(() => {
        document.querySelectorAll('[role="dialog"][data-state="open"], [data-assets-picker-popover="true"]').forEach((d) => {
            const close = d.querySelector('button[aria-label*="Close" i], button[aria-label*="Dismiss" i], button svg');
            if (close) { try { (close.closest('button') || close).click(); } catch (e) {} }
        });
    });
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(400);

    // 2. Click tab "References" (CHÍNH XÁC, không nhầm "Extend Video") - Bỏ qua nếu đã active
    const clicked = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('button[role="radio"], button, div[role="tab"]'));
        // Ưu tiên text CHÍNH XÁC "References" / "Reference"
        let ref = candidates.find((b) => {
            const t = (b.textContent || '').trim().toLowerCase();
            return t === 'references' || t === 'reference';
        });
        if (!ref) {
            // fallback: chứa "references" nhưng KHÔNG chứa "extend"
            ref = candidates.find((b) => /references/i.test(b.textContent || '') && !/extend/i.test(b.textContent || ''));
        }
        if (ref) {
            const state = ref.getAttribute('data-state') || ref.getAttribute('aria-checked') || ref.getAttribute('aria-selected');
            if (state === 'on' || state === 'true' || ref.classList.contains('active')) {
                return false; // Đã active sẵn, không click lại để tránh React re-render reset form
            }
            (ref.closest('button') || ref).click();
            return true;
        }
        return false;
    });
    await sleep(600);
    if (clicked) onLog('🔄 Đã chuyển sang chế độ References (tránh Extend Video mode).');
    return clicked;
}

/**
 * Tìm công tắc Unlimited Mode bằng selector NGỮ NGHĨA (KHÔNG dùng XPath cứng).
 * Ưu tiên: role="switch" và aria-label="Unlimited mode" (bỏ qua nút info).
 * Trả về element clickable hoặc null.
 */
function findUnlimitedSwitch(doc) {
    const root = doc || document;

    // 1. CHÍNH XÁC 100%: Button có role="switch" và aria-label="Unlimited mode" (hoặc chứa "Unlimited" và KHÔNG chứa "info")
    let el = root.querySelector('button[role="switch"][aria-label="Unlimited mode"], button[role="switch"][aria-label*="Unlimited" i], button[role="switch"][aria-checked]');
    if (el) {
        const lbl = (el.getAttribute('aria-label') || '').toLowerCase();
        if (!lbl.includes('info')) {
            if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
            return el;
        }
    }

    // 2. Bất kỳ element có role="switch" nào bên trong #video-create-layout (bỏ qua mọi nút info/tooltip)
    const switches = Array.from(root.querySelectorAll('#video-create-layout button[role="switch"], button[role="switch"]')).filter((s) => {
        const lbl = (s.getAttribute('aria-label') || '').toLowerCase();
        return !lbl.includes('info');
    });
    if (switches.length > 0) {
        const sw = switches[0].closest('button') || switches[0];
        if (sw.scrollIntoView) sw.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        return sw;
    }

    // 3. Fallback: Nút có class giống switch nằm gần nhãn "Unlimited" (loại bỏ nút info)
    const labels = Array.from(root.querySelectorAll('div, span, label')).filter(
        (e) => (e.textContent || '').trim().toLowerCase() === 'unlimited'
    );
    for (const lbl of labels) {
        let ctx = lbl;
        for (let i = 0; i < 4 && ctx; i++) {
            const sw = ctx.querySelector('button[role="switch"], [role="switch"], button[aria-checked]');
            if (sw) {
                const btn = sw.closest('button') || sw;
                const ariaLbl = (btn.getAttribute('aria-label') || '').toLowerCase();
                if (!ariaLbl.includes('info')) {
                    if (btn.scrollIntoView) btn.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
                    return btn;
                }
            }
            ctx = ctx.parentElement;
        }
    }

    // 4. Fallback: input type=checkbox gần text Unlimited
    const cb = root.querySelector('input[type="checkbox"]');
    if (cb && (cb.closest('label, div')?.textContent || '').toLowerCase().includes('unlimited')) {
        if (cb.scrollIntoView) cb.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        return cb;
    }
    return null;
}

/**
 * Đặt trạng thái công tắc Unlimited về đúng mong muốn.
 * @returns {boolean} true nếu đã đạt trạng thái mong muốn
 */
async function setUnlimited(page, wantOn, onLog = () => {}) {
    // Quan trọng: đảm bảo chế độ References (tránh bị chuyển sang Extend Video mode làm tắt Unlimited)
    await ensureReferencesMode(page, onLog);

    // Chờ và lấy trạng thái switch với cơ chế polling retry (tối đa 6 lần = 3s)
    let info = { found: false };
    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        info = await page.evaluate(() => {
            const sw = (window.__findUnlimitedSwitch && window.__findUnlimitedSwitch()) || document.querySelector('button[role="switch"][aria-label="Unlimited mode"]');
            if (!sw) return { found: false };
            const clickable = sw.closest('button') || sw;
            const state = clickable.getAttribute('data-state') || clickable.getAttribute('aria-checked');
            const isOn = state === 'on' || state === 'true' || clickable.checked === true;
            const genBtn = (window.__getFormGenerateButton && window.__getFormGenerateButton()) || document.querySelector('#video-create-layout form button[type="submit"]');
            return {
                found: true,
                isOn,
                genHasUnlimited: genBtn ? /unlimited/i.test(genBtn.textContent || '') : false
            };
        });

        if (info && info.found) break;
        if (attempt < maxAttempts) {
            await sleep(500);
        }
    }

    await sleep(400); // đợi DOM ổn định

    if (!info || !info.found) {
        onLog('⚠️ Không tìm thấy công tắc Unlimited Mode (selector ngữ nghĩa thất bại sau khi chờ).');
        return false;
    }

    // Nếu đã đạt trạng thái mong muốn -> xong (tránh click thêm làm đảo ngược trạng thái)
    if (info.isOn === wantOn) {
        onLog(`🔘 Unlimited Mode đã ở trạng thái ${wantOn ? 'ON' : 'OFF'}.`);
        return true;
    }

    // Bấm công tắc bằng DOM click trực tiếp vào element ĐÚNG (bên trong #video-create-layout),
    // bypass mọi lớp che (nav banner quảng cáo ở header).
    await page.evaluate(() => {
        const sw = (window.__findUnlimitedSwitch && window.__findUnlimitedSwitch()) || document.querySelector('button[role="switch"][aria-label="Unlimited mode"]');
        if (sw) {
            const c = sw.closest('button') || sw;
            c.click();
            c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
    });
    await sleep(2500); // đợi Radix cập nhật + Generate render chữ Unlimited

    // Verify lại với retry (tối đa 5 lần)
    let after = { isOn: false, genHasUnlimited: false, genText: '' };
    for (let v = 1; v <= 5; v++) {
        after = await page.evaluate(() => {
            const sw = (window.__findUnlimitedSwitch && window.__findUnlimitedSwitch()) || document.querySelector('button[role="switch"][aria-label="Unlimited mode"]');
            const clickable = sw ? sw.closest('button') || sw : null;
            const state = clickable ? clickable.getAttribute('data-state') || clickable.getAttribute('aria-checked') : null;
            const isOn = state === 'on' || state === 'true' || (clickable && clickable.checked === true);
            const genBtn = (window.__getFormGenerateButton && window.__getFormGenerateButton()) || document.querySelector('#video-create-layout form button[type="submit"]');
            const genText = genBtn ? (genBtn.textContent || '').trim().replace(/\s+/g, ' ') : '';
            return { isOn, genHasUnlimited: /unlimited/i.test(genText), genText };
        });

        if (after.isOn === wantOn) {
            onLog(`🔘 Đã ${wantOn ? 'BẬT' : 'TẮT'} Unlimited Mode thành công (data-state: ${wantOn ? 'on' : 'off'}, nút Generate: "${after.genText}").`);
            return true;
        }
        if (v < 5) await sleep(600);
    }

    onLog(`⚠️ Bấm Unlimited nhưng trạng thái chưa như ý (isOn=${after.isOn}, genHasUnlimited=${after.genHasUnlimited}, nút="${after.genText}").`);
    return after.isOn === wantOn;
}

/**
 * Kiểm tra xem người dùng đã đăng nhập Higgsfield chưa.
 * Dựa vào: URL redirect về /login, hoặc thiếu #video-create-layout mà có nút Sign in.
 */
async function isLoggedIn(page) {
    const res = await page.evaluate(() => {
        const url = location.href;
        if (/\/login|\/signin|\/auth/i.test(url)) return false;
        const hasLayout = !!document.querySelector('#video-create-layout');
        const signIn = Array.from(document.querySelectorAll('button, a')).some((b) =>
            /sign\s?in|log\s?in|đăng nhập/i.test(b.textContent || '')
        );
        if (!hasLayout && signIn) return false;
        return true;
    });
    return res;
}

/**
 * Lấy popover đang mở (ưu tiên theo role dialog/menu/listbox + data-state=open).
 * Tránh bắt nhầm asset-picker (z-[900], không có role) thay vì dropdown thật.
 */
function getActivePopover() {
    const candidates = Array.from(
        document.querySelectorAll('[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"]')
    );
    // Ưu tiên popover có role rõ ràng và đang mở
    const byRole = candidates.filter((p) => {
        const role = p.getAttribute('role');
        if (role !== 'dialog' && role !== 'menu' && role !== 'listbox') return false;
        const st = p.getAttribute('data-state');
        return st === null || st === 'open' || p.offsetParent !== null;
    });
    if (byRole.length > 0) {
        // Chọn cái gần nhất với viewport (có kích thước) và visible
        const visible = byRole.filter((p) => p.offsetParent !== null && (p.getBoundingClientRect().width > 0 || p.getBoundingClientRect().height > 0));
        return (visible[0] || byRole[0]).outerHTML.slice(0, 120);
    }
    // Fallback: popover nào visible
    const vis = candidates.find((p) => p.offsetParent !== null);
    return vis ? vis : document;
}

/**
 * Mở popover bằng nút trigger (regex trên text) và chọn option (khớp text).
 * Throw rõ ràng nếu không tìm thấy trigger/option (KHÔNG nuốt lỗi).
 */
async function pickOption(page, triggerRegexSrc, optionText, { onLog = () => {}, stepLabel = '' } = {}) {
    const triggered = await page.evaluate((src) => {
        const re = new RegExp(src, 'i');
        const layout = document.querySelector('#video-create-layout') || document;
        const btn = Array.from(layout.querySelectorAll('button')).find((b) => re.test(b.textContent || ''));
        if (btn) {
            btn.click();
            return true;
        }
        return false;
    }, triggerRegexSrc);

    if (!triggered) {
        throw new Error(`[${stepLabel}] Không tìm thấy nút kích hoạt (regex: ${triggerRegexSrc}).`);
    }
    await sleep(600);

    const picked = await page.evaluate((optText) => {
        return (window.__clickOption && window.__clickOption(optText, false)) || false;
    }, optionText);

    if (!picked) {
        throw new Error(`[${stepLabel}] Không tìm thấy option "${optionText}" trong popover.`);
    }
    onLog(`✅ Đã chọn "${optionText}".`);
    await sleep(600);
}

/**
 * Tìm root của modal upload (chống hardcode z-index Tailwind).
 * Dò từ input[type=file] ngược lên tới phần tử có role=dialog hoặc fixed/absolute z>=100.
 */
function getUploadModalRoot() {
    const input = document.querySelector('input[type="file"]');
    if (!input) return null;
    let el = input;
    while (el && el !== document.body) {
        const role = el.getAttribute && el.getAttribute('role');
        const st = getComputedStyle(el);
        if (role === 'dialog' || st.position === 'fixed' || (st.position === 'absolute' && (parseInt(st.zIndex, 10) || 0) >= 100)) {
            return el;
        }
        el = el.parentElement;
    }
    return null;
}

/**
 * Chọn thumbnail tham chiếu MỚI NHẤT (index = beforeCount) thay vì luôn [0].
 * Trả về index đã chọn, hoặc -1 nếu không có card mới.
 */
async function pickReferenceCard(page, beforeCount) {
    return await page.evaluate((idx) => {
        const root = (window.__getUploadModalRoot && window.__getUploadModalRoot()) || document;
        const cards = Array.from(root.querySelectorAll('button.absolute.inset-0'));
        if (cards.length === 0) return -1;
        const targetIdx = cards.length > idx ? idx : cards.length - 1;
        cards[targetIdx].click();
        return targetIdx;
    }, beforeCount);
}

/**
 * Đóng modal upload bằng nút đóng (aria-label / svg không có text).
 */
async function closeUploadModal(page) {
    await page.evaluate(() => {
        const root = (window.__getUploadModalRoot && window.__getUploadModalRoot()) || document;
        const closeBtn =
            root.querySelector('button[aria-label*="Close" i], button[aria-label*="Dismiss" i]') ||
            Array.from(root.querySelectorAll('button')).find((b) => {
                const svg = b.querySelector('svg');
                return svg && !(b.textContent || '').trim();
            });
        if (closeBtn) closeBtn.click();
    });
}

/**
 * (Bước 11) Xác nhận lệnh Generate được chấp nhận và chờ video hoàn tất.
 * Trả về { videoUrl, videoSrc, videoPath } (best-effort; không fail task nếu không harvest được).
 */
async function waitForVideoCompletion(page, opts) {
    const {
        targetJobId = null,
        baselineAssetIds = [],
        onProgress = () => {},
        onLog = () => {},
        onScreenshot = () => {},
        pollTimeoutMs = 1500000, // 25 phút (đảm bảo đủ thời gian chờ hàng đợi Unlimited mùa cao điểm)
        pollIntervalMs = 5000,
        downloadVideo = false,
        outputDir = path.join(process.cwd(), 'downloads'),
        checkGallery = false,
        signal = null
    } = opts;

    const checkCancel = () => {
        if (signal && signal.aborted) {
            const e = new Error('Task cancelled by user signal');
            e.name = 'AbortError';
            throw e;
            }
    };

    // --- 1. Xác nhận submit thành công & phát hiện newAssetId ---
    onLog('⏳ Đợi xác nhận Higgsfield tiếp nhận lệnh tạo video...');
    let submissionConfirmed = !!targetJobId;
    let detectedNewAssetId = targetJobId;

    if (targetJobId) {
        onLog(`🎯 Đã có Job ID từ API: ${targetJobId}`);
    } else {
        const subStart = Date.now();
        while (Date.now() - subStart < 25000) {
            checkCancel();
            const st = await page.evaluate((baselineIds) => {
                const txt = (document.body.innerText || '').toLowerCase();
                const genBtn = (window.__getFormGenerateButton && window.__getFormGenerateButton()) || document.querySelector('#video-create-layout form button[type="submit"]');
                const genDisabled = genBtn ? genBtn.disabled || /generating|processing|creating/i.test(genBtn.textContent || '') : false;
                const hasProgress = !!document.querySelector('[class*="progress" i], [class*="spinner" i], [role="progressbar"]');
                const errorToast = /quota|limit reached|please upgrade|not enough|payment|error/i.test(txt) && !/unlimited/i.test(txt);

                // Tìm assetId mới chưa có trong baseline
                const allCards = Array.from(document.querySelectorAll('[data-asset-id], [data-cinematic-cell-id]'));
                let newId = null;
                for (const c of allCards) {
                    const id = c.getAttribute('data-asset-id') || c.getAttribute('data-cinematic-cell-id');
                    if (id && !baselineIds.includes(id)) {
                        newId = id;
                        break;
                    }
                }

                return { txt, genDisabled, hasProgress, errorToast, newId };
            }, baselineAssetIds);

            if (st.errorToast) {
                throw new Error('⛔ Higgsfield từ chối tạo video (quota/payment/error). Hủy luồng.');
            }
            if (st.newId) {
                detectedNewAssetId = st.newId;
                submissionConfirmed = true;
                onLog(`🎯 Đã nhận diện task tạo video mới trên Higgsfield (Asset ID: ${st.newId})`);
                break;
            }
            if (st.genDisabled || st.hasProgress) {
                submissionConfirmed = true;
                break;
            }
            await sleep(2000);
        }
    }

    if (!submissionConfirmed) {
        throw new Error('⛔ Nút Generate chưa được kích hoạt thành công trên Higgsfield (không thấy tiến trình mới nào xuất hiện).');
    }

    // --- 2. Chờ video render xong ---
    onLog('⏳ Đang chờ video render xong trên Higgsfield (chế độ Unlimited thường mất 2-15 phút)...');
    const start = Date.now();
    let found = null;

    const probe = async () => {
        return await page.evaluate((targetId, baselineIds) => {
            const allCards = Array.from(document.querySelectorAll('[data-asset-id], [data-job-status], [data-cinematic-cell-id]'));
            
            // Tìm card mục tiêu:
            // 1. Card có assetId trùng targetId (nếu đã bắt được)
            // 2. Hoặc card mới không nằm trong baselineIds
            // 3. Hoặc card đầu tiên trên cùng của feed nếu không có baseline
            let targetCard = null;
            if (targetId) {
                targetCard = allCards.find(c => (c.getAttribute('data-asset-id') === targetId || c.getAttribute('data-cinematic-cell-id') === targetId));
            }
            if (!targetCard) {
                targetCard = allCards.find(c => {
                    const id = c.getAttribute('data-asset-id') || c.getAttribute('data-cinematic-cell-id');
                    return id && !baselineIds.includes(id);
                });
            }

            // Nếu vẫn không thấy card mới, kiểm tra xem có card nào đang trong trạng thái processing/generating không
            const isPageBusy = !!document.querySelector('[class*="progress" i], [class*="spinner" i], [role="progressbar"], [aria-label*="generating" i], [data-job-status="in_progress"], [data-job-status="processing"], [data-job-status="queued"]');

            if (!targetCard) {
                if (isPageBusy) {
                    return { status: 'generating', message: 'Higgsfield đang khởi tạo tiến trình sinh video...' };
                }
                return { status: 'waiting', message: 'Đang đợi xuất hiện card kết quả...' };
            }

            const jobStatus = (targetCard.getAttribute('data-job-status') || '').toLowerCase();
            const currentAssetId = targetCard.getAttribute('data-asset-id') || targetCard.getAttribute('data-cinematic-cell-id');

            // Kiểm tra lỗi / nsfw
            if (jobStatus === 'nsfw') {
                return { status: 'failed', reason: 'Nội dung bị bộ lọc an toàn của Higgsfield từ chối (NSFW / Policy Filter).' };
            }
            if (jobStatus === 'failed') {
                return { status: 'failed', reason: 'Higgsfield báo lỗi tạo video (Generation failed).' };
            }

            // Nếu card đang chạy
            if (jobStatus === 'in_progress' || jobStatus === 'processing' || jobStatus === 'queued' || jobStatus === 'waiting' || jobStatus === '') {
                const progEl = targetCard.querySelector('[role="progressbar"], [class*="progress" i]');
                const progText = progEl ? (progEl.innerText || progEl.getAttribute('aria-valuenow') || '') : '';
                return { status: 'generating', assetId: currentAssetId, jobStatus, progText };
            }

            // Nếu card đã hoàn tất (jobStatus === 'completed')
            if (jobStatus === 'completed') {
                // 1. Lấy video src trực tiếp từ thẻ <video>
                const vid = targetCard.querySelector('video');
                const vidSrc = vid ? (vid.src || vid.currentSrc) : null;
                if (vidSrc && !vidSrc.includes('static.higgsfield.ai') && !vidSrc.includes('blob:')) {
                    return { status: 'completed', assetId: currentAssetId, url: vidSrc };
                }

                // 2. Trích xuất URL video CloudFront từ thẻ thumbnail img (hỗ trợ cả Cloudflare CDN wrapper và direct CDN)
                const img = targetCard.querySelector('img');
                const imgSrc = img ? (img.src || img.getAttribute('src') || '') : '';
                const match = imgSrc.match(/user_([^\/]+)\/hf_([a-zA-Z0-9_-]+)_thumbnail/);
                if (match) {
                    const derivedCloudFrontUrl = `https://d8j0ntlcm91z4.cloudfront.net/user_${match[1]}/hf_${match[2]}.mp4`;
                    return { status: 'completed', assetId: currentAssetId, url: derivedCloudFrontUrl };
                }

                // 3. Hover vào card để kích hoạt liên kết tải
                targetCard.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                targetCard.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                const aTag = targetCard.querySelector('a[href*=".mp4"]');
                if (aTag && !aTag.href.includes('static.higgsfield.ai')) {
                    return { status: 'completed', assetId: currentAssetId, url: aTag.href };
                }

                // 4. Fallback từ bất kỳ URL cloudfront của user này
                const allUserCloudfront = Array.from(document.querySelectorAll('video, a, source'))
                    .map(e => e.src || e.href || '')
                    .filter(u => u.includes('cloudfront.net/user_') && !u.includes('static.higgsfield.ai'));
                if (allUserCloudfront.length > 0) {
                    return { status: 'completed', assetId: currentAssetId, url: allUserCloudfront[0] };
                }

                return { status: 'generating', assetId: currentAssetId, message: 'Đang hoàn tất đóng gói video...' };
            }

            return { status: 'generating', assetId: currentAssetId, jobStatus };
        }, detectedNewAssetId, baselineAssetIds);
    };

    while (Date.now() - start < pollTimeoutMs) {
        checkCancel();
        const r = await probe();

        if (r && r.status === 'failed') {
            throw new Error(`⛔ ${r.reason || 'Lỗi khi tạo video trên Higgsfield.'}`);
        }

        if (r && r.status === 'completed' && r.url) {
            found = r;
            break;
        }

        // Cập nhật trạng thái và thời gian chờ
        const elapsedSec = Math.round((Date.now() - start) / 1000);
        const mins = Math.floor(elapsedSec / 60);
        const secs = elapsedSec % 60;
        const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        const extraInfo = r && r.progText ? ` (${r.progText})` : '';

        onLog(`⏳ Video đang được tạo trên Higgsfield... [${timeStr}]${extraInfo}`);

        // Stream screenshot
        if (page && !page.isClosed()) {
            try {
                const shot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 50 });
                onScreenshot(shot);
            } catch (e) {}
        }

        await sleep(pollIntervalMs);
    }

    if (!found) {
        onLog('⚠️ Hết thời gian chờ nhưng không thu thập được URL video. Task vẫn coi là đã gửi lệnh thành công.');
        return { videoUrl: null, videoSrc: null, videoPath: null };
    }

    onLog(`✅ Đã tìm thấy video mới hoàn tất: ${found.url}`);

    let videoPath = null;
    if (downloadVideo) {
        try {
            if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
            const ext = (found.url.split('?')[0].match(/\.(mp4|webm|mov)$/i) || ['.mp4'])[0];
            const fname = `video_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;
            videoPath = path.join(outputDir, fname);
            await downloadFile(found.url, videoPath);
            onLog(`💾 Đã tải video về: ${videoPath}`);
        } catch (e) {
            onLog(`⚠️ Tải video thất bại: ${e.message}`);
        }
    }

    return { videoUrl: found.url, videoSrc: found.url, videoPath };
}

/** Tải file qua HTTP(S) với retry nhỏ */
async function downloadFile(url, destPath, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const u = new URL(url);
            const lib = u.protocol === 'https:' ? await import('https') : await import('http');
            await new Promise((resolve, reject) => {
                const req = lib.get(url, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        return downloadFile(res.headers.location, destPath, retries).then(resolve).catch(reject);
                    }
                    if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
                    const file = fs.createWriteStream(destPath);
                    res.pipe(file);
                    file.on('finish', () => file.close(() => resolve()));
                });
                req.on('error', reject);
                req.setTimeout(60000, () => req.destroy(new Error('timeout')));
            });
            return;
        } catch (e) {
            if (attempt === retries) throw e;
            await sleep(2000);
        }
    }
}

/**
 * 10-Step (+ Step 11) Higgsfield AI Video Generation Automation Engine via Chrome DevTools Protocol (CDP)
 */
export async function video_generate(options = {}) {
    const {
        prompt = 'Cinematic video description',
        imagePath = null,
        imagePaths = null,
        videoPath = null,
        videoPaths = null,
        clearOldImage = true,
        model = 'Seedance 2.5',
        duration = '20s',
        aspectRatio = '16:9',
        resolution = '720p',
        unlimited = true,
        dryRun = false,
        saveVideo = true, // chờ & thu thập URL video sau Generate
        downloadVideo = false, // tải video về local (tốn thời gian/băng thông)
        checkGallery = false, // thử sang /library nếu không thấy trên trang kết quả
        outputDir = path.join(process.cwd(), 'downloads'),
        pollTimeoutMs = 600000,
        cdpHost = process.env.CDP_HOST || '127.0.0.1',
        cdpPort = process.env.CDP_PORT || 9333,
        onProgress = () => {},
        onScreenshot = () => {},
        onLog = () => {},
        onBeforeGenerate = null,  // async callback: gọi trước bước ấn Generate — dùng để chờ CLI rảnh + download xong
        signal = null
    } = options;

    const browserURL = `http://${cdpHost}:${cdpPort}`;
    let browser = null;

    const log = (msg) => {
        console.log(`[video_generate] ${msg}`);
        try {
            onLog(msg);
        } catch (e) {}
    };

    const checkCancellation = () => {
        if (signal && signal.aborted) {
            const abortErr = new Error('Task cancelled by user signal');
            abortErr.name = 'AbortError';
            throw abortErr;
        }
    };

    const reportProgress = async (step, total, message, page = null) => {
        checkCancellation();
        log(`📍 [${step}/${total}] ${message}`);
        try {
            onProgress(step, total, message);
        } catch (e) {}

        if (page && !page.isClosed()) {
            try {
                const screenshotBase64 = await page.screenshot({
                    encoding: 'base64',
                    type: 'jpeg',
                    quality: 60
                });
                onScreenshot(screenshotBase64);
            } catch (e) {}
        }
    };

    // Tiêm helper vào page để evaluate dùng lại
    const injectHelpers = async (page) => {
        await page.evaluate(() => {
            window.__getFormGenerateButton = function () {
                const layout = document.querySelector('#video-create-layout') || document;
                const form = layout.querySelector('form') || layout;
                let btn = form.querySelector('button[type="submit"]');
                if (btn) return btn;
                const btns = Array.from(form.querySelectorAll('button')).filter((b) => {
                    if (b.closest('header, aside, [role="banner"]')) return false;
                    const txt = (b.textContent || '').trim();
                    return /generate/i.test(txt) && !txt.includes('Exclusive');
                });
                if (btns.length > 0) return btns[btns.length - 1];
                return null;
            };
            window.__findUnlimitedSwitch = function () {
                // CHỈ tìm trong #video-create-layout (tránh nhầm công tắc Unlimited của quảng cáo/banner ở header)
                const root = document.querySelector('#video-create-layout') || document;

                // 1. CHÍNH XÁC 100%: Button có role="switch" và aria-label="Unlimited mode" (hoặc chứa "Unlimited" và KHÔNG chứa "info")
                let el = root.querySelector('button[role="switch"][aria-label="Unlimited mode"], button[role="switch"][aria-label*="Unlimited" i], button[role="switch"][aria-checked]');
                if (el) {
                    const lbl = (el.getAttribute('aria-label') || '').toLowerCase();
                    if (!lbl.includes('info')) {
                        if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
                        return el;
                    }
                }

                // 2. Bất kỳ element có role="switch" nào bên trong layout (bỏ qua mọi nút info/tooltip)
                const switches = Array.from(root.querySelectorAll('button[role="switch"], [role="switch"]')).filter((s) => {
                    const lbl = (s.getAttribute('aria-label') || '').toLowerCase();
                    return !lbl.includes('info');
                });
                if (switches.length > 0) {
                    const sw = switches[0].closest('button') || switches[0];
                    if (sw.scrollIntoView) sw.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
                    return sw;
                }

                // 3. Fallback: Nút có class giống switch nằm gần nhãn "Unlimited" (loại bỏ nút info)
                const labels = Array.from(root.querySelectorAll('div, span, label')).filter(
                    (e) => (e.textContent || '').trim().toLowerCase() === 'unlimited'
                );
                for (const lbl of labels) {
                    let ctx = lbl;
                    for (let i = 0; i < 4 && ctx; i++) {
                        const sw = ctx.querySelector('button[role="switch"], [role="switch"], button[aria-checked]');
                        if (sw) {
                            const btn = sw.closest('button') || sw;
                            const ariaLbl = (btn.getAttribute('aria-label') || '').toLowerCase();
                            if (!ariaLbl.includes('info')) {
                                if (btn.scrollIntoView) btn.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
                                return btn;
                            }
                        }
                        ctx = ctx.parentElement;
                    }
                }

                // 6. Fallback: input type=checkbox gần text Unlimited
                const cb = root.querySelector('input[type="checkbox"]');
                if (cb && (cb.closest('label, div')?.textContent || '').toLowerCase().includes('unlimited')) {
                    if (cb.scrollIntoView) cb.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
                    return cb;
                }

                return null;
            };
            window.__getUploadModalRoot = function () {
                const input = document.querySelector('input[type="file"]');
                if (!input) return null;
                let el = input;
                while (el && el !== document.body) {
                    const role = el.getAttribute && el.getAttribute('role');
                    const st = getComputedStyle(el);
                    if (role === 'dialog' || st.position === 'fixed' || (st.position === 'absolute' && (parseInt(st.zIndex, 10) || 0) >= 100)) {
                        return el;
                    }
                    el = el.parentElement;
                }
                return null;
            };
            window.__clickOption = function (optText, exact) {
                const norm = (s) => (s || '').trim().toLowerCase();
                const target = norm(optText);
                // Duyệt tất cả popovers có role rõ ràng (tránh asset-picker không role)
                const popovers = Array.from(
                    document.querySelectorAll('[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"]')
                ).filter((p) => {
                    const role = p.getAttribute('role');
                    return role === 'dialog' || role === 'menu' || role === 'listbox';
                });
                for (const p of popovers) {
                    const btns = Array.from(p.querySelectorAll('button, [role="option"]'));
                    const match = exact
                        ? btns.find((b) => norm(b.textContent) === target)
                        : btns.find((b) => norm(b.textContent).includes(target));
                    if (match) {
                        (match.closest('button') || match).click();
                        return true;
                    }
                }
                return false;
            };
        });
    };

    log(`🚀 Đang kết nối Chrome CDP tại ${cdpHost}:${cdpPort}...`);

    try {
        checkCancellation();
        let wsUrl = null;
        try {
            const versionData = await new Promise((resolve, reject) => {
                const req = http.get(
                    {
                        host: cdpHost,
                        port: cdpPort,
                        path: '/json/version',
                        headers: { Host: `127.0.0.1:${cdpPort}` },
                        timeout: 3000
                    },
                    (res) => {
                        let d = '';
                        res.on('data', (chunk) => (d += chunk));
                        res.on('end', () => {
                            try {
                                resolve(JSON.parse(d));
                            } catch (e) {
                                reject(e);
                            }
                        });
                    }
                );
                req.on('error', reject);
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('timeout'));
                });
            });
            if (versionData && versionData.webSocketDebuggerUrl) {
                const urlObj = new URL(versionData.webSocketDebuggerUrl);
                urlObj.hostname = cdpHost;
                urlObj.port = String(cdpPort);
                wsUrl = urlObj.toString();
            }
        } catch (err) {
            log(`⚠️ Không thể lấy webSocketDebuggerUrl trực tiếp: ${err.message}`);
        }

        browser = await puppeteer.connect({
            browserWSEndpoint: wsUrl || browserURL,
            headers: { Host: `127.0.0.1:${cdpPort}` },
            defaultViewport: null
        });

        // =========================================================================
        // BƯỚC 1: TÌM TAB & F5 RELOAD TRANG SẠCH + KIỂM TRA ĐĂNG NHẬP
        // =========================================================================
        const pages = await browser.pages();
        let page = pages.find((p) => {
            try {
                const url = p.url();
                return url.includes('higgsfield.ai');
            } catch {
                return false;
            }
        });

        if (!page) {
            page = pages.length > 0 ? pages[0] : await browser.newPage();
        }

        // Tự động kiểm tra và phóng to toàn màn hình Chrome CDP (Chống thu nhỏ / minimize)
        await ensureBrowserMaximized(page, browser, log);

        await reportProgress(1, 11, 'F5 Reload trang Studio (https://higgsfield.ai/ai/video)', page);

        const currentUrl = page.url();
        if (!currentUrl.includes('higgsfield.ai/ai/video')) {
            await page.goto('https://higgsfield.ai/ai/video', { waitUntil: 'domcontentloaded', timeout: 30000 });
        } else {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        }

        await sleep(1000);
        await ensureBrowserMaximized(page, browser, log);
        await page.bringToFront().catch(() => {});
        page.setDefaultTimeout(15000);

        // Chờ layout studio render đầy đủ
        await page.waitForSelector('#video-create-layout, form', { visible: true, timeout: 20000 }).catch(() => {});
        await sleep(800);
        await injectHelpers(page);

        // Kiểm tra đăng nhập (FIX #9)
        const loggedIn = await isLoggedIn(page);
        if (!loggedIn) {
            throw new Error('🔒 Chưa đăng nhập Higgsfield (phát hiện màn hình Login). Hãy mở Chrome CDP và đăng nhập trước khi chạy queue.');
        }

        // Tự động kiểm tra và đảm bảo giao diện full screen gốc 100% không bị viền trắng
        await ensureBrowserMaximized(page, browser, log);

        // =========================================================================
        // BƯỚC 2: Chọn AI Model (Seedance 2.5) TRƯỚC TIÊN — KHÔNG nuốt lỗi
        // =========================================================================
        await reportProgress(2, 11, `Chọn AI Model: ${model}`, page);
        const modelOpened = await page.evaluate(() => {
            const layout = document.querySelector('#video-create-layout') || document;
            const modelBtn =
                layout.querySelector('button[aria-label="Model"], [aria-label*="Model" i]') ||
                Array.from(layout.querySelectorAll('button')).find((b) => /seedance|flux|kling/i.test(b.textContent || ''));
            if (modelBtn) {
                modelBtn.click();
                return true;
            }
            return false;
        });
        if (!modelOpened) {
            throw new Error('Bước 2: Không tìm thấy nút chọn Model.');
        }
        await sleep(600);
        const modelPicked = await page.evaluate((targetModel) => {
            return (window.__clickOption && window.__clickOption(targetModel, false)) || false;
        }, model);
        if (!modelPicked) {
            throw new Error(`Bước 2: Không tìm thấy Model "${model}" trong danh sách.`);
        }
        log(`🤖 Đã chọn AI Model: "${model}". Đợi 1s để giao diện cấu hình lại slots...`);
        await sleep(1000);

        // =========================================================================
        // BƯỚC 3: KHÓA CHẾ ĐỘ REFERENCES & ĐÓNG BANNER
        // =========================================================================
        await reportProgress(3, 11, 'Thiết lập chế độ References & đóng banner...', page);
        await page.evaluate(() => {
            const banners = Array.from(document.querySelectorAll('div, section, aside')).filter(
                (el) => (el.textContent || '').includes('Exclusive Access') || (el.textContent || '').includes('exclusive access')
            );
            banners.forEach((b) => {
                const closeBtn = b.querySelector('button[aria-label*="close" i], button[aria-label*="dismiss" i]');
                if (closeBtn) (closeBtn.closest('button') || closeBtn).click();
            });

            const layout = document.querySelector('#video-create-layout') || document;
            const buttons = Array.from(layout.querySelectorAll('button[role="radio"], button, div[role="tab"]'));
            const refBtn = buttons.find((b) => (b.textContent || '').trim() === 'References');
            if (refBtn) refBtn.click();
        });
        await sleep(600);

        // =========================================================================
        // BƯỚC 4: Xóa TOÀN BỘ ảnh / video tham chiếu cũ nếu có
        // =========================================================================
        if (clearOldImage) {
            await reportProgress(4, 11, 'Kiểm tra và xóa toàn bộ ảnh/video tham chiếu cũ...', page);
            let totalRemoved = 0;
            for (let pass = 0; pass < 10; pass++) {
                const removed = await page.evaluate(() => {
                    const form = document.querySelector('#video-create-layout form') || document.querySelector('#video-create-layout') || document;
                    const removeBtns = Array.from(form.querySelectorAll('button')).filter((b) => {
                        const isFormBtn = b.closest('form');
                        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                        const cls = b.className || '';
                        const isRemoveBtn = (cls.includes('-top-') && cls.includes('-right-')) || aria.includes('remove reference') || aria.includes('delete reference');
                        return isFormBtn && isRemoveBtn;
                    });
                    if (removeBtns.length > 0) {
                        removeBtns[0].click();
                        return true;
                    }
                    return false;
                });
                if (removed) {
                    totalRemoved++;
                    await sleep(350);
                } else {
                    break;
                }
            }
            if (totalRemoved > 0) {
                log(`🗑️ Đã xóa sạch ${totalRemoved} tệp tham chiếu cũ.`);
            }
        }

        // =========================================================================
        // BƯỚC 5: Tải Hàng Loạt & Chọn các tệp tham chiếu (Nhiều ảnh + Video)
        // =========================================================================
        const imageFiles = [];
        const videoFiles = [];

        if (Array.isArray(imagePaths)) {
            imagePaths.forEach((p) => p && imageFiles.push(resolveToHostPath(p)));
        } else if (typeof imagePaths === 'string' && imagePaths.trim()) {
            imagePaths
                .split(/[\n,]+/)
                .map((s) => s.trim())
                .filter(Boolean)
                .forEach((p) => {
                    imageFiles.push(resolveToHostPath(p));
                });
        } else if (imagePath) {
            imageFiles.push(resolveToHostPath(imagePath));
        }

        if (Array.isArray(videoPaths)) {
            videoPaths.forEach((p) => p && videoFiles.push(resolveToHostPath(p)));
        } else if (typeof videoPaths === 'string' && videoPaths.trim()) {
            videoPaths
                .split(/[\n,]+/)
                .map((s) => s.trim())
                .filter(Boolean)
                .forEach((p) => {
                    videoFiles.push(resolveToHostPath(p));
                });
        } else if (videoPath && typeof videoPath === 'string' && videoPath.trim()) {
            videoFiles.push(resolveToHostPath(videoPath.trim()));
        }

        // QUY TẮC BẮT BUỘC:
        // 1. Ảnh LUÔN ĐƯỢC GÁN TRƯỚC (theo đúng thứ tự lượt tải lên)
        // 2. Video LUÔN ĐƯỢC GÁN CUỐI CÙNG (nếu có nhiều video thì gán theo thứ tự lượt tải lên)
        const mediaFiles = [...imageFiles, ...videoFiles];

        if (mediaFiles.length > 0) {
            const fileNamesStr = mediaFiles.map((f) => path.basename(f)).join(', ');
            await reportProgress(5, 11, `Nạp ${mediaFiles.length} tệp tham chiếu (${fileNamesStr})`, page);
            log(`🚀 Bắt đầu nạp đồng thời ${mediaFiles.length} tệp tham chiếu (${imageFiles.length} ảnh, ${videoFiles.length} video): [${fileNamesStr}]...`);

            // 1. Mở modal tải tệp (Nút to "Add references" nếu chưa có slot, hoặc nút '+' nếu đã có)
            let isModalOpen = await page.evaluate(() => {
                return !!document.querySelector('input[type="file"]');
            });

            if (!isModalOpen) {
                await page.evaluate(() => {
                    const layout = document.querySelector('#video-create-layout') || document;
                    const bigBtn = Array.from(layout.querySelectorAll('button')).find(
                        (b) => (b.textContent || '').includes('Add references') || (b.textContent || '').includes('Image, Video')
                    );
                    if (bigBtn) {
                        bigBtn.click();
                        return;
                    }
                    const plusBtn = Array.from(layout.querySelectorAll('button')).find((b) => {
                        const isForm = b.closest('form');
                        const cls = b.className || '';
                        const is48px = cls.includes('48px') || cls.includes('surface-secondary');
                        const isSlot = isForm && (is48px || b.querySelector('svg'));
                        return isSlot && !b.textContent.trim();
                    });
                    if (plusBtn) plusBtn.click();
                });
                await sleep(1500);
            }

            // 2. Chuyển sang Tab Uploads
            await page.evaluate(() => {
                const tabs = Array.from(document.querySelectorAll('button, div[role="tab"]'));
                const uploadsTab = tabs.find((t) => (t.textContent || '').trim().toLowerCase() === 'uploads');
                if (uploadsTab) uploadsTab.click();
            });
            await sleep(600);

            // 3. Tìm input[type="file"] và nạp ĐỒNG THỜI TẤT CẢ các tệp
            let fileInput = await page.$('input[type="file"]');
            if (!fileInput) {
                fileInput = await page.waitForSelector('input[type="file"]', { timeout: 6000 }).catch(() => null);
            }
            if (!fileInput) {
                throw new Error('Không tìm thấy input[type="file"] trong modal upload.');
            }

            const beforeCount = await page.evaluate(() => {
                const fileInput = document.querySelector('input[type="file"]');
                const modalRoot = fileInput ? fileInput.closest('div.fixed, div[class*="fixed"], div[class*="modal"]') : document;
                return modalRoot.querySelectorAll('button[aria-label*="Select" i], button.absolute.inset-0').length;
            });

            log(`📤 Đang tải lên đồng thời cả ${mediaFiles.length} tệp qua CDP...`);
            await fileInput.uploadFile(...mediaFiles);

            // 4. BẮT BUỘC CHỜ ĐỦ 3 PHÚT (180 giây) để Higgsfield hoàn tất kiểm tra/xử lý
            const mandatoryWaitSec = 180; // Bắt buộc đủ 3 phút (180s)
            const startTime = Date.now();
            log(`⏳ [BẮT BUỘC CHỜ ĐỦ 3 PHÚT / 180s] Đang tải lên và chờ Higgsfield kiểm tra, phân tích, kiểm duyệt toàn bộ ${mediaFiles.length} tệp tham chiếu...`);

            while (true) {
                const elapsedSec = Math.round((Date.now() - startTime) / 1000);
                if (elapsedSec >= mandatoryWaitSec) {
                    break;
                }

                await sleep(3000);
                const currentSec = Math.round((Date.now() - startTime) / 1000);
                const remainingSec = Math.max(0, mandatoryWaitSec - currentSec);

                // Stream screenshot liên tục
                if (page && !page.isClosed()) {
                    try {
                        const shot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 50 });
                        onScreenshot(shot);
                    } catch (e) {}
                }

                if (currentSec % 15 === 0 || currentSec === 5) {
                    log(`⏳ [${currentSec}s/180s] (Còn lại ${remainingSec}s) Đang trong thời gian chờ bắt buộc 3 phút để Higgsfield xử lý tệp tham chiếu...`);
                    await reportProgress(5, 11, `Chờ Higgsfield xử lý tệp [${currentSec}s/180s - còn ${remainingSec}s]`, page);
                }
            }

            log(`✅ ĐÃ HOÀN TẤT ĐỦ 3 PHÚT (180s) CHỜ AN TOÀN. Bắt đầu tiến hành chọn các tệp tham chiếu đã xử lý...`);

            // 5. Đính kèm chính xác từng Ảnh và Video theo loại media (Atomic Multi-Media Selection)
            log(`📌 Đang chọn đồng thời ${imageFiles.length} ảnh và ${videoFiles.length} video trong modal Uploads...`);

            const selectRes = await page.evaluate(async ({ numImages, numVideos }) => {
                const modal = document.querySelector('div[data-assets-picker-media-card="true"]')?.closest('div.fixed, div[class*="fixed"], div[class*="modal"]') || 
                              document.querySelector('div.fixed, div[class*="fixed"], div[class*="modal"]') || 
                              document;

                const mediaCards = Array.from(modal.querySelectorAll('[data-assets-picker-media-card="true"]'));
                if (mediaCards.length === 0) {
                    return { success: false, error: 'Không tìm thấy media card nào trong modal Uploads' };
                }

                const isVideoCard = (card) => {
                    const hasSvg = !!card.querySelector('svg');
                    const hasVideo = !!card.querySelector('video');
                    const img = card.querySelector('img');
                    const imgSrc = (img ? (img.src || img.getAttribute('srcset') || '') : '').toLowerCase();
                    const hasThumb = imgSrc.includes('thumb');
                    const hasDuration = /^\s*\d+:\d+\s*$/.test(card.innerText || '') || (card.innerText || '').includes(':');
                    return hasSvg || hasVideo || hasThumb || hasDuration;
                };

                const imageCards = mediaCards.filter(c => !isVideoCard(c));
                const videoCards = mediaCards.filter(c => isVideoCard(c));

                const selectedImages = [];
                const selectedVideos = [];

                // Chọn đúng số lượng ảnh yêu cầu (từ mới nhất đến cũ hơn)
                for (let i = 0; i < Math.min(numImages, imageCards.length); i++) {
                    const card = imageCards[i];
                    const btn = card.querySelector('button') || card;
                    btn.click();
                    selectedImages.push(btn.getAttribute('aria-label') || `image_${i}`);
                    await new Promise(r => setTimeout(r, 600));
                }

                // Chọn đúng số lượng video yêu cầu (từ mới nhất đến cũ hơn)
                for (let i = 0; i < Math.min(numVideos, videoCards.length); i++) {
                    const card = videoCards[i];
                    const btn = card.querySelector('button') || card;
                    btn.click();
                    selectedVideos.push(btn.getAttribute('aria-label') || `video_${i}`);
                    await new Promise(r => setTimeout(r, 600));
                }

                return {
                    success: true,
                    totalMediaCards: mediaCards.length,
                    imageCardsFound: imageCards.length,
                    videoCardsFound: videoCards.length,
                    selectedImagesCount: selectedImages.length,
                    selectedVideosCount: selectedVideos.length
                };
            }, { numImages: imageFiles.length, numVideos: videoFiles.length });

            log(`📦 [Kết quả chọn thẻ] ${JSON.stringify(selectRes)}`);
            await sleep(1000);

            // 6. Đóng modal upload an toàn sau khi đã chọn xong tất cả các tệp
            await page.keyboard.press('Escape');
            await sleep(500);
            await page.evaluate(() => {
                const modal = document.querySelector('div[data-assets-picker-media-card="true"]')?.closest('div.fixed, div[class*="fixed"], div[class*="modal"]') ||
                              document.querySelector('div.fixed, div[class*="fixed"], div[class*="modal"]');
                if (!modal) return;
                const closeBtn = modal.querySelector('button[aria-label*="Close" i], button[aria-label*="Dismiss" i]');
                if (closeBtn) closeBtn.click();
            });
            await sleep(1500);

            // =========================================================================
            // BƯỚC 5.5: ĐỐI CHIẾU THAM CHIẾU GIỮA HỆ THỐNG VÀ HIGGSFIELD
            // =========================================================================
            const expectedCount = mediaFiles.length;
            let actualCount = await page.evaluate(() => {
                const form = document.querySelector('#video-create-layout form') || document.querySelector('#video-create-layout') || document;
                const removeBtns = Array.from(form.querySelectorAll('button')).filter((b) => {
                    const isFormBtn = b.closest('form');
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    const cls = b.className || '';
                    const isRemoveBtn = (cls.includes('-top-') && cls.includes('-right-')) || aria.includes('remove reference') || aria.includes('delete reference');
                    return isFormBtn && isRemoveBtn;
                });
                const mediaElements = Array.from(form.querySelectorAll('figure img, figure video, div.relative img, div.relative video')).filter(el => {
                    const src = el.src || '';
                    return !src.includes('static.higgsfield.ai');
                });
                return Math.max(removeBtns.length, mediaElements.length);
            });

            log(`🔍 [ĐỐI CHIẾU THAM CHIẾU] Yêu cầu: ${expectedCount} tệp (${fileNamesStr}) | Thực tế trên Higgsfield: ${actualCount} tệp.`);

            if (actualCount < expectedCount) {
                log(`⚠️ Phát hiện thiếu slot (${actualCount}/${expectedCount}), thử mở lại modal để bổ sung slot còn thiếu...`);
                // Mở lại modal để click bổ sung nếu thiếu
                await page.evaluate(() => {
                    const plusBtn = Array.from(document.querySelectorAll('#video-create-layout form button')).find(b => {
                        const cls = b.className || '';
                        return (cls.includes('48px') || cls.includes('surface-secondary') || b.querySelector('svg')) && !b.textContent.trim();
                    });
                    if (plusBtn) plusBtn.click();
                });
                await sleep(1200);

                // Chuyển uploads tab và click bổ sung
                await page.evaluate(async ({ numImages, numVideos }) => {
                    const tabs = Array.from(document.querySelectorAll('button, div[role="tab"]'));
                    const uploadsTab = tabs.find((t) => (t.textContent || '').trim().toLowerCase() === 'uploads');
                    if (uploadsTab) uploadsTab.click();
                    await new Promise(r => setTimeout(r, 800));

                    const mediaCards = Array.from(document.querySelectorAll('[data-assets-picker-media-card="true"]'));
                    const isVideoCard = (card) => {
                        return !!card.querySelector('svg') || !!card.querySelector('video') || (card.querySelector('img')?.src || '').includes('thumb') || (card.innerText || '').includes(':');
                    };
                    const imageCards = mediaCards.filter(c => !isVideoCard(c));
                    const videoCards = mediaCards.filter(c => isVideoCard(c));

                    for (let i = 0; i < Math.min(numImages, imageCards.length); i++) {
                        imageCards[i].querySelector('button')?.click();
                        await new Promise(r => setTimeout(r, 500));
                    }
                    for (let i = 0; i < Math.min(numVideos, videoCards.length); i++) {
                        videoCards[i].querySelector('button')?.click();
                        await new Promise(r => setTimeout(r, 500));
                    }
                }, { numImages: imageFiles.length, numVideos: videoFiles.length });

                await page.keyboard.press('Escape');
                await sleep(1000);

                actualCount = await page.evaluate(() => {
                    const form = document.querySelector('#video-create-layout form') || document.querySelector('#video-create-layout') || document;
                    const removeBtns = Array.from(form.querySelectorAll('button')).filter((b) => {
                        const isFormBtn = b.closest('form');
                        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                        const cls = b.className || '';
                        return isFormBtn && ((cls.includes('-top-') && cls.includes('-right-')) || aria.includes('remove reference') || aria.includes('delete reference'));
                    });
                    const mediaElements = Array.from(form.querySelectorAll('figure img, figure video, div.relative img, div.relative video')).filter(el => {
                        const src = el.src || '';
                        return !src.includes('static.higgsfield.ai');
                    });
                    return Math.max(removeBtns.length, mediaElements.length);
                });
                log(`🔍 [ĐỐI CHIẾU LẠI] Sau khi bổ sung: ${actualCount}/${expectedCount} tệp.`);
            }

            if (actualCount < expectedCount) {
                throw new Error(`⛔ Đối chiếu tham chiếu thất bại: Task yêu cầu ${expectedCount} tệp (${fileNamesStr}) nhưng trên Higgsfield chỉ gắn được ${actualCount} tệp.`);
            } else {
                log(`🎯 [ĐỐI CHIẾU HOÀN HẢO] Đã xác nhận 100%: Higgsfield đang đính kèm đủ ${actualCount}/${expectedCount} tệp tham chiếu.`);
                await reportProgress(5, 11, `Đã đính kèm & đối chiếu đủ ${actualCount}/${expectedCount} tệp tham chiếu`, page);
            }
        }

        // =========================================================================
        // BƯỚC 6: Nhập Prompt (Focus, Clear & Type - ĐÃ ĐẢO RA SAU BƯỚC NẠP THAM CHIẾU)
        // =========================================================================
        const cleanPrompt = sanitizePrompt(prompt || '');
        await reportProgress(6, 11, `Nhập Prompt: "${cleanPrompt.slice(0, 45)}..."`, page);

        const promptInputHandle = await page.evaluateHandle(() => {
            const layout = document.querySelector('#video-create-layout') || document;
            return (
                layout.querySelector('div.focus\\:outline-none') ||
                layout.querySelector('[contenteditable="true"]') ||
                layout.querySelector('div.pb-4 div.w-full > div.relative > div') ||
                layout.querySelector('textarea') ||
                layout.querySelector('[role="textbox"]')
            );
        });

        if (!promptInputHandle || !promptInputHandle.asElement()) {
            throw new Error('Không tìm thấy ô nhập Prompt trên giao diện (#video-create-layout).');
        }

        const promptEl = promptInputHandle.asElement();
        // Dùng DOM .focus() + .click() thay vì elementHandle.click() (CDP mouse)
        // để tránh kẹt khi element nằm ngoài viewport / bị che.
        await page.evaluate((el) => {
            try {
                el.focus();
            } catch (e) {}
            try {
                el.click();
            } catch (e) {}
        }, promptEl);
        await sleep(200);

        await page.evaluate((el) => {
            el.focus();
            if (el.isContentEditable) {
                el.innerText = '';
                el.innerHTML = '';
            } else if (el.value !== undefined) {
                el.value = '';
            }
        }, promptEl);

        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');

        const execOk = await page.evaluate((text) => {
            return document.execCommand('insertText', false, text);
        }, cleanPrompt);
        if (!execOk) {
            await page.keyboard.type(cleanPrompt, { delay: 1 });
        }
        await sleep(600);

        // =========================================================================
        // BƯỚC 7: Chọn Duration — BEST-EFFORT (Higgsfield có thể không có UI chọn)
        // =========================================================================
        const targetDuration = duration || '20s';
        await reportProgress(7, 11, `Chọn Duration: ${targetDuration}`, page);
        const targetSec = parseInt(String(targetDuration).replace(/\D/g, ''), 10) || 0;
        if (targetSec > 0) {
            await trySetDuration(page, targetSec, log);
        } else {
            log(`⚠️ Duration không hợp lệ ("${targetDuration}"), bỏ qua.`);
        }

        // =========================================================================
        // BƯỚC 8: Chọn Aspect Ratio (16:9, 9:16, 1:1) — KHÔNG nuốt lỗi
        // =========================================================================
        await reportProgress(8, 11, `Chọn Aspect Ratio: ${aspectRatio}`, page);
        await pickOption(page, '\\b\\d+:\\d+\\b', aspectRatio, { onLog: log, stepLabel: 'Bước 8' });

        // =========================================================================
        // BƯỚC 9: Chọn Resolution (720p) & Đưa Bitrate về Standard — KHÔNG nuốt lỗi
        // =========================================================================
        const targetRes = resolution || '720p';
        await reportProgress(9, 11, `Chọn Resolution: ${targetRes} & Chuẩn hóa Bitrate`, page);
        // 1. Bitrate -> Standard
        const bitrateOpened = await page.evaluate(() => {
            const layout = document.querySelector('#video-create-layout') || document;
            const bitrateBtn = Array.from(layout.querySelectorAll('button')).find(
                (b) => (b.textContent || '').includes('Bitrate') || (b.textContent || '').includes('High')
            );
            if (bitrateBtn && (bitrateBtn.textContent || '').includes('High')) {
                bitrateBtn.click();
                return true;
            }
            return false;
        });
        if (bitrateOpened) {
            await sleep(600);
            const bitratePicked = await page.evaluate(() => {
                return (window.__clickOption && window.__clickOption('Standard', false)) || (window.__clickOption && window.__clickOption('Normal', false)) || false;
            });
            if (!bitratePicked) {
                throw new Error('Bước 9: Không tìm thấy tùy chọn Bitrate Standard/Normal.');
            }
            await sleep(600);
        }

        // 2. Resolution
        const resOpened = await page.evaluate(() => {
            const layout = document.querySelector('#video-create-layout') || document;
            const resBtn = layout.querySelector('button[aria-label*="Resolution" i]') || Array.from(layout.querySelectorAll('button')).find(
                (b) => b.getAttribute('aria-label') === 'Resolution'
            ) || Array.from(layout.querySelectorAll('button')).find(
                (b) => {
                    if (b.closest('header, aside, [role="banner"]')) return false;
                    const txt = (b.textContent || '').trim();
                    return (txt === '1080p' || txt === '720p') && !txt.includes('Exclusive');
                }
            );
            if (resBtn) {
                resBtn.click();
                return true;
            }
            return false;
        });
        if (!resOpened) {
            throw new Error('Bước 9: Không tìm thấy nút chọn Resolution.');
        }
        await sleep(600);
        const resPicked = await page.evaluate((r) => {
            return (window.__clickOption && window.__clickOption(r, false)) || false;
        }, targetRes);
        if (!resPicked) {
            throw new Error(`Bước 9: Không tìm thấy Resolution "${targetRes}".`);
        }
        log('⏳ Đợi 2s để giao diện Studio đóng popover và render công tắc Unlimited...');
        await sleep(2000);

        // =========================================================================
        // BƯỚC 9.5: BẬT CÔNG TẮC UNLIMITED MODE (selector NGỮ NGHĨA, FIX #2)
        // =========================================================================
        if (unlimited) {
            await reportProgress(9, 11, 'Bật công tắc Unlimited Mode (Xanh ON)...', page);
            const ok = await setUnlimited(page, true, log);
            if (!ok) {
                throw new Error('⛔ Không thể bật Unlimited Mode — công tắc không tìm thấy. Hủy để tránh trừ credit.');
            }
            await sleep(800);
        }

        // =========================================================================
        // BƯỚC 9.9: TỰ ĐỘNG KIỂM TRA LẠI TOÀN BỘ TRƯỚC KHI BẤM (SELF-HEALING)
        // =========================================================================
        await reportProgress(9, 11, '🔍 Tự động kiểm tra lại toàn bộ thông số & tự sửa lỗi...', page);

        let verificationPasses = 3;
        while (verificationPasses-- > 0) {
            const checkReport = await page.evaluate(async (cfg) => {
                const layout = document.querySelector('#video-create-layout') || document;
                const fixes = [];

                const refBtn = Array.from(layout.querySelectorAll('button[role="radio"], button, div[role="tab"]')).find(
                    (b) => (b.textContent || '').trim() === 'References'
                );
                if (refBtn && refBtn.getAttribute('data-state') !== 'on') {
                    refBtn.click();
                    fixes.push('Chuyển lại tab References');
                    await new Promise((r) => setTimeout(r, 400));
                }

                const banners = Array.from(document.querySelectorAll('div, section, aside')).filter(
                    (el) => (el.textContent || '').includes('Exclusive Access') || (el.textContent || '').includes('exclusive access')
                );
                banners.forEach((b) => {
                    const closeBtn = b.querySelector('button[aria-label*="close" i], button[aria-label*="dismiss" i]');
                    if (closeBtn) {
                        (closeBtn.closest('button') || closeBtn).click();
                        fixes.push('Đóng banner Exclusive 1080p');
                    }
                });

                const promptEl =
                    layout.querySelector('div.focus\\:outline-none') ||
                    layout.querySelector('[contenteditable="true"]') ||
                    layout.querySelector('textarea') ||
                    layout.querySelector('[role="textbox"]');
                if (promptEl) {
                    const currentText = (promptEl.innerText || promptEl.value || '').trim();
                    if (!currentText || currentText.length < 3) {
                        promptEl.focus();
                        if (promptEl.isContentEditable) {
                            promptEl.innerText = '';
                            promptEl.innerHTML = '';
                        } else if (promptEl.value !== undefined) {
                            promptEl.value = '';
                        }
                        document.execCommand('insertText', false, cfg.prompt);
                        fixes.push('Gõ lại nội dung Prompt');
                    }
                }

                const bitrateBtn = Array.from(layout.querySelectorAll('button')).find(
                    (b) => (b.textContent || '').includes('Bitrate') || (b.textContent || '').includes('High')
                );
                if (bitrateBtn && (bitrateBtn.textContent || '').includes('High')) {
                    bitrateBtn.click();
                    await new Promise((r) => setTimeout(r, 400));
                    if (window.__clickOption) {
                        window.__clickOption('Standard', false) || window.__clickOption('Normal', false);
                    }
                    fixes.push('Chuyển Bitrate về Standard');
                }

                const resBtn = layout.querySelector('button[aria-label*="Resolution" i]') || Array.from(layout.querySelectorAll('button')).find(
                    (b) => b.getAttribute('aria-label') === 'Resolution'
                );
                if (resBtn && (resBtn.textContent || '').trim() === '1080p') {
                    resBtn.click();
                    await new Promise((r) => setTimeout(r, 400));
                    if (window.__clickOption) window.__clickOption('720p', false);
                    fixes.push('Chọn lại Resolution 720p');
                }

                if (cfg.unlimited) {
                    const sw = (window.__findUnlimitedSwitch && window.__findUnlimitedSwitch());
                    if (sw) {
                        const clickable = sw.closest('button') || sw;
                        const state = clickable.getAttribute('data-state') || clickable.getAttribute('aria-checked');
                        if (state !== 'on' && state !== 'true') {
                            clickable.click();
                            fixes.push('Bật lại công tắc Unlimited mode');
                        }
                    }
                }

                const genBtn = (window.__getFormGenerateButton && window.__getFormGenerateButton()) || layout.querySelector('form button[type="submit"]');
                const genText = genBtn ? (genBtn.textContent || '').trim().replace(/\s+/g, ' ') : '';
                const isUnlimitedReady = /unlimited/i.test(genText);

                return { fixes, generateText: genText, isUnlimitedReady };
            }, { prompt, unlimited, duration: targetDuration, resolution: targetRes });

            if (checkReport.fixes.length > 0) {
                log(`🔧 Tự động sửa lại trước khi bấm: ${checkReport.fixes.join(', ')}`);
                await sleep(1000);
            } else {
                log(`✅ Kiểm tra toàn diện thành công! Trạng thái nút: "${checkReport.generateText}"`);
                break;
            }
        }

        // =========================================================================
        // BƯỚC 10: Bấm nút Generate Unlimited & Xác nhận
        // =========================================================================
        await reportProgress(10, 11, 'Bấm nút Generate Unlimited...', page);
        await ensureBrowserMaximized(page, browser, log);

        // Đảm bảo Unlimited Mode được bật chắc chắn 100% trước khi bấm
        if (unlimited) {
            let readyUnlimited = false;
            for (let chk = 1; chk <= 3; chk++) {
                const stateCheck = await page.evaluate(() => {
                    const sw = (window.__findUnlimitedSwitch && window.__findUnlimitedSwitch()) || document.querySelector('button[role="switch"][aria-label="Unlimited mode"]');
                    const swOn = sw ? (sw.getAttribute('data-state') === 'on' || sw.getAttribute('aria-checked') === 'true') : false;
                    const genBtn = (window.__getFormGenerateButton && window.__getFormGenerateButton()) || document.querySelector('#video-create-layout form button[type="submit"]');
                    const txt = genBtn ? (genBtn.textContent || '').trim() : '';
                    return { swOn, hasUnlimitedText: /unlimited/i.test(txt), txt };
                });

                if (stateCheck.swOn && stateCheck.hasUnlimitedText) {
                    readyUnlimited = true;
                    break;
                }
                log(`🔄 Đang kích hoạt lại Unlimited Mode (Lần ${chk}/3)...`);
                await setUnlimited(page, true, log);
                await sleep(1500);
            }

            if (!readyUnlimited) {
                const finalCheck = await page.evaluate(() => {
                    const genBtn = (window.__getFormGenerateButton && window.__getFormGenerateButton()) || document.querySelector('#video-create-layout form button[type="submit"]');
                    return genBtn ? (genBtn.textContent || '').trim() : '';
                });
                if (!/unlimited/i.test(finalCheck)) {
                    throw new Error(`⛔ DỪNG KHẨN CẤP (CREDIT SAFETY): NÚT GENERATE HIỆN TẠI LÀ "${finalCheck}", KHÔNG PHẢI CHẾ ĐỘ UNLIMITED! Hủy để bảo vệ credits tài khoản.`);
                }
            }
        }

        if (dryRun) {
            log('🧪 [DRY RUN]: Đã thực hiện và kiểm tra thành công các bước 1-9! Dừng trước Bước 10 theo yêu cầu dryRun.');
            await reportProgress(10, 11, '🧪 [DRY RUN HOÀN TẤT] Đã kiểm tra xong từ Bước 1 đến 9!', page);
            return { success: true, dryRun: true };
        }

        // ─── ĐIỂM CHỜ: CLI rảnh + download video trước xong ───────────────────
        // Tất cả bước chuẩn bị đã xong (upload, prompt, thông số).
        // Bây giờ mới chờ điều kiện cho phép bấm Generate.
        if (onBeforeGenerate) {
            log('⏸️ [Bước 10] Chờ điều kiện cho phép bấm Generate (CLI rảnh + download xong)...');
            await onBeforeGenerate();
            checkCancellation();
            log('✅ [Bước 10] Điều kiện đã đáp ứng — tiến hành bấm Generate.');
        }

        // Ghi lại danh sách assetId hiện có trước khi bấm Generate (Baseline)
        const baselineAssetIds = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('[data-asset-id], [data-cinematic-cell-id]'))
                .map((el) => el.getAttribute('data-asset-id') || el.getAttribute('data-cinematic-cell-id'))
                .filter(Boolean);
        });

        log('🚀 Tiến hành bấm nút Generate Unlimited & xác thực kết nối...');

        // Đón bắt phản hồi API từ Higgsfield
        let apiResponsePromise = page.waitForResponse(
            (res) => (res.url().includes('/fnf/jobs/') || res.url().includes('/generate') || res.url().includes('/jobs/v2/')) && res.request().method() === 'POST',
            { timeout: 8000 }
        ).catch(() => null);

        // Kích hoạt bấm nút Generate bằng nhiều tầng sự kiện (DOM click, mouse events, requestSubmit)
        const clickResult = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => {
                const t = (b.innerText || b.textContent || '').trim().toLowerCase();
                return (t.includes('generate') || b.getAttribute('aria-label') === 'Generate') && b.offsetParent !== null;
            }) || document.querySelector('#video-create-layout form button[type="submit"]');

            if (!btn) return { clicked: false, error: 'Không tìm thấy nút Generate hiển thị trên giao diện.' };

            if (btn.scrollIntoView) btn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
            btn.focus();
            btn.click();
            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

            const form = btn.closest('form') || document.querySelector('#video-create-layout form');
            if (form && typeof form.requestSubmit === 'function') {
                try { form.requestSubmit(btn); } catch (e) { try { form.requestSubmit(); } catch (e2) {} }
            }

            return { clicked: true, text: (btn.innerText || '').replace(/\n/g, ' ') };
        });

        if (!clickResult.clicked) {
            throw new Error(`⛔ ${clickResult.error}`);
        }

        log(`✅ Đã gửi lệnh bấm nút Generate ("${clickResult.text}"). Chờ Higgsfield xác nhận tiếp nhận...`);

        // Kiểm tra phản hồi API với cơ chế tự động chờ & thử lại thông minh nếu gặp Rate Limit / Concurrent Limit
        let confirmedJobId = null;
        let apiRes = await apiResponsePromise;
        if (apiRes) {
            const status = apiRes.status();
            log(`📡 [API HIGGSFIELD] Nhận phản hồi POST ${apiRes.url().split('?')[0]} -> HTTP ${status}`);
            if (status >= 200 && status < 300) {
                try {
                    const resJson = await apiRes.json();
                    confirmedJobId = resJson?.id || resJson?.job_id || resJson?.job?.id || resJson?.asset_id || null;
                    if (confirmedJobId) {
                        log(`🎯 [JOB ID XÁC THỰC] Higgsfield đã tạo Job: ${confirmedJobId}`);
                    }
                } catch (e) {}
            } else if (status >= 400) {
                let errMsg = `HTTP ${status}`;
                let isRateLimit = false;
                try {
                    const errJson = await apiRes.json();
                    errMsg = errJson?.message || errJson?.error || JSON.stringify(errJson);
                    if (errMsg.includes('rate_limit_reached') || errMsg.includes('concurrent_jobs_limit') || status === 429) {
                        isRateLimit = true;
                    }
                } catch (e) {}

                if (isRateLimit) {
                    log(`⚠️ [GIỚI HẠN TIẾN TRÌNH] Tài khoản Higgsfield đang có 1 video khác đang chạy (concurrent_jobs_limit: 1).`);
                    log(`⏳ Hệ thống sẽ tự động chờ video trước hoàn tất và thử bấm Generate lại...`);
                    
                    let retrySuccess = false;
                    for (let r = 1; r <= 8; r++) {
                        log(`⏳ [Tự động thử lại ${r}/8] Chờ 20s để tài khoản Higgsfield rảnh...`);
                        await sleep(20000);
                        await ensureBrowserMaximized(page, browser, log);

                        if (unlimited) {
                            await setUnlimited(page, true, log);
                        }

                        const retryApiPromise = page.waitForResponse(
                            (res) => (res.url().includes('/fnf/jobs/') || res.url().includes('/generate') || res.url().includes('/jobs/v2/')) && res.request().method() === 'POST',
                            { timeout: 8000 }
                        ).catch(() => null);

                        await page.evaluate(() => {
                            const btn = Array.from(document.querySelectorAll('button')).find(b => {
                                const t = (b.innerText || b.textContent || '').trim().toLowerCase();
                                return (t.includes('generate') || b.getAttribute('aria-label') === 'Generate') && b.offsetParent !== null;
                            }) || document.querySelector('#video-create-layout form button[type="submit"]');
                            if (btn) {
                                btn.click();
                                const form = btn.closest('form');
                                if (form && form.requestSubmit) { try { form.requestSubmit(btn); } catch (e) {} }
                            }
                        });

                        const retryRes = await retryApiPromise;
                        if (retryRes && retryRes.status() >= 200 && retryRes.status() < 300) {
                            try {
                                const resJson = await retryRes.json();
                                confirmedJobId = resJson?.id || resJson?.job_id || resJson?.job?.id || resJson?.asset_id || null;
                            } catch (e) {}
                            log(`🎯 [THỬ LẠI THÀNH CÔNG] Higgsfield đã tiếp nhận lệnh tạo video (Job ID: ${confirmedJobId || 'OK'})!`);
                            retrySuccess = true;
                            break;
                        }
                    }

                    if (!retrySuccess) {
                        throw new Error(`⛔ Higgsfield từ chối tạo video: ${errMsg}`);
                    }
                } else {
                    throw new Error(`⛔ Higgsfield từ chối tạo video: ${errMsg}`);
                }
            }
        } else {
            log('⚠️ Chưa nhận được phản hồi API qua network, chuyển sang theo dõi DOM feed...');
        }

        await sleep(2000);
        await reportProgress(10, 11, '✅ Đã gửi lệnh tạo video thành công!', page);

        // =========================================================================
        // BƯỚC 11 (FIX #1): XÁC NHẬN + CHỜ VIDEO HOÀN TẤT + THU THẬP URL (optional download)
        // =========================================================================
        let videoResult = { videoUrl: null, videoSrc: null, videoPath: null };
        if (saveVideo) {
            await reportProgress(11, 11, '⏳ Chờ video render & thu thập liên kết...', page);
            videoResult = await waitForVideoCompletion(page, {
                targetJobId: confirmedJobId,
                baselineAssetIds,
                onProgress,
                onLog: log,
                onScreenshot,
                pollTimeoutMs,
                downloadVideo,
                outputDir,
                checkGallery,
                signal
            });
            if (videoResult.videoUrl) {
                log(`🎬 Video sẵn sàng: ${videoResult.videoUrl}`);
            }
        }

        return {
            success: true,
            videoUrl: videoResult.videoUrl,
            videoSrc: videoResult.videoSrc,
            videoPath: videoResult.videoPath
        };
    } catch (err) {
        log(`❌ Lỗi thực thi video_generate: ${err.message}`);
        throw err;
    } finally {
        if (browser) {
            try {
                browser.disconnect();
            } catch (e) {}
        }
    }
}
