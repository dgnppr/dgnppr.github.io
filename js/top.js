// Scroll Progress Ring + Share Widget
// - 페이지 로드 시 바로 노출 (스크롤 임계값 없음)
// - SVG progress ring를 스크롤 진행률로 갱신
// - 공유 버튼 클릭 시 LinkedIn·X·복사 패널 토글
// - rAF throttle로 scroll 핸들러 부하 완화

var prefersReducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

var ticking = false;

function scrollFunction() {
    // ring 제거됨 — 스크롤 이벤트는 향후 확장을 위해 유지
}

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

function topFunction() {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
}

// 공유 패널 토글
function shareFunction() {
    var panel = document.getElementById('sharePanel');
    var shareBtn = document.getElementById('shareBtn');
    if (!panel) return;

    var isOpen = !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', isOpen);
    if (shareBtn) shareBtn.setAttribute('aria-expanded', String(isOpen));

    if (isOpen) {
        var url = encodeURIComponent(window.location.href);
        var title = encodeURIComponent(document.title);

        var el = {
            linkedin: document.getElementById('shareLinkedIn'),
            twitter:  document.getElementById('shareTwitter'),
            facebook: document.getElementById('shareFacebook'),
        };
        if (el.linkedin) el.linkedin.href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + url;
        if (el.twitter)  el.twitter.href  = 'https://twitter.com/intent/tweet?url=' + url + '&text=' + title;
        if (el.facebook) el.facebook.href = 'https://www.facebook.com/sharer/sharer.php?u=' + url;
    }
}

// 링크 복사
function copyLink() {
    var url = window.location.href;
    var copyBtn = document.getElementById('shareCopy');

    function showFeedback() {
        if (!copyBtn) return;
        copyBtn.classList.add('copied');
        var prev = copyBtn.getAttribute('aria-label');
        copyBtn.setAttribute('aria-label', '복사 완료!');
        setTimeout(function () {
            copyBtn.classList.remove('copied');
            copyBtn.setAttribute('aria-label', prev || '링크 복사');
        }, 1500);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(showFeedback).catch(function () {});
        return;
    }

    var input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    try { document.execCommand('copy'); showFeedback(); } catch (e) {}
    document.body.removeChild(input);
}

document.addEventListener('DOMContentLoaded', function () {
    scrollFunction();

    var shareBtn = document.getElementById('shareBtn');
    if (shareBtn) {
        shareBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            shareFunction();
        });
    }

    var copyBtn = document.getElementById('shareCopy');
    if (copyBtn) {
        copyBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            copyLink();
        });
    }

    // 위젯 외부 클릭 시 패널 닫기
    document.addEventListener('click', function (e) {
        var panel = document.getElementById('sharePanel');
        var widget = document.getElementById('topWidget');
        if (panel && panel.classList.contains('is-open') &&
            widget && !widget.contains(e.target)) {
            panel.classList.remove('is-open');
            var btn = document.getElementById('shareBtn');
            if (btn) btn.setAttribute('aria-expanded', 'false');
        }
    });
});
