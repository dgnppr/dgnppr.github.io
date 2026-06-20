// Scroll Progress Ring + Smart Action Widget
// - 첫 1 viewport 이후 등장(.is-visible 토글)
// - SVG progress ring를 스크롤 진행률로 갱신
// - rAF throttle로 scroll 핸들러 부하 완화

var RING_CIRCUMFERENCE = 125.66; // 2π·20 (r=20)

var prefersReducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

var ticking = false;

// 스크롤 상태를 위젯에 반영
function scrollFunction() {
    var widget = document.getElementById('topWidget');
    var btn = document.getElementById('topBtn');
    if (!btn) return;

    var doc = document.documentElement;
    var body = document.body;

    var scrollTop = doc.scrollTop || body.scrollTop;
    var scrollHeight = doc.scrollHeight || body.scrollHeight;
    var clientHeight = doc.clientHeight || window.innerHeight;

    var scrollable = scrollHeight - clientHeight;
    var p = scrollable > 0 ? scrollTop / scrollable : 0; // 0~1 진행률
    if (p < 0) p = 0;
    if (p > 1) p = 1;

    // progress ring 갱신
    var ringFill = btn.querySelector('.top-widget__ring-fill');
    if (ringFill) {
        ringFill.style.strokeDashoffset = (RING_CIRCUMFERENCE * (1 - p)).toFixed(2);
    }

    // aria-label 진행률 동기 갱신
    var percent = Math.round(p * 100);
    btn.setAttribute('aria-label', '맨 위로 이동 (읽은 비율 ' + percent + '%)');
    btn.setAttribute('aria-valuenow', String(percent));

    // 첫 1 viewport 이후 등장
    var visible = scrollTop > window.innerHeight;
    if (widget) {
        widget.classList.toggle('is-visible', visible);
        widget.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }
}

// rAF throttle wrapper
function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
        scrollFunction();
        ticking = false;
    });
}

window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll, { passive: true });

// 페이지 상단으로 스크롤
function topFunction() {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
}

// 공유 동작 (P1): navigator.share 우선, 미지원 시 클립보드 복사 fallback
function shareFunction() {
    var url = window.location.href;
    var title = document.title;

    if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () {});
        return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
            flashShareFeedback('링크가 복사되었습니다');
        }).catch(function () {});
        return;
    }

    // 구형 브라우저 fallback
    var input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    try { document.execCommand('copy'); flashShareFeedback('링크가 복사되었습니다'); } catch (e) {}
    document.body.removeChild(input);
}

function flashShareFeedback(message) {
    var shareBtn = document.getElementById('shareBtn');
    if (!shareBtn) return;
    var original = shareBtn.getAttribute('aria-label');
    shareBtn.setAttribute('aria-label', message);
    setTimeout(function () {
        shareBtn.setAttribute('aria-label', original || '이 글 공유하기');
    }, 2000);
}

document.addEventListener('DOMContentLoaded', function () {
    scrollFunction();
    var shareBtn = document.getElementById('shareBtn');
    if (shareBtn) shareBtn.addEventListener('click', shareFunction);
});
