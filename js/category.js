(function() {
    function getTarget() {
        var thisName = document.getElementById('thisName').value;
        return thisName;
    }

    /*
     * category 타입의 문서 내부에 하위 문서 목록을 만들어 줍니다.
     */
    const target = getTarget();

    fetch(`/data/metadata/${target}.json`)
        .then(response => response.json())
        .then(function(data) {
            if (data == null) {
                return;
            }

            const children = data.children;

            var html = '';
            for (var i = 0; i < children.length; i++) {
                html += `<li id="child-document-${i}" class="home-feed-item"></li>`
            }
            document.getElementById('document-list').innerHTML = `<ul class="home-feed">${html}</ul>`

            if (data.children && data.children.sort) {
                insertChildren(data.children.sort());
            }
            return;
        })
        .catch(function(error) {
            console.error(error);
        });

    /**
     * 자식 문서들의 목록을 받아, 자식 문서 하나 하나의 링크를 만들어 삽입합니다.
     */
    function insertChildren(children) {
        for (let i = 0; i < children.length; i++) {
            const target = children[i];

            fetch(`/data/metadata/${target}.json`)
                .then(response => response.json())
                .then(function(data) {
                    if (data == null) {
                        return;
                    }

                    const rawDate = data.updated.replace(/^(\d{4}-\d{2}-\d{2}).*/, '$1');
                    const updated = new Date(rawDate + 'T00:00:00')
                        .toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
                    const count = (data.children && data.children.length > 0) ? data.children.length : 0;
                    const badge = count > 0
                        ? `<span class="wiki-card-badge" aria-label="하위 문서 ${count}개">${count}</span>`
                        : '';

                    const html =
                        `<a href="${data.url}" class="home-feed-link">` +
                            `<span class="home-feed-title">${data.title}</span>` +
                            `<span class="home-feed-meta">` +
                                badge +
                                `<time class="home-feed-date" datetime="${updated}">${updated}</time>` +
                            `</span>` +
                        `</a>`;
                    document.getElementById(`child-document-${i}`).innerHTML = html;

                    return;
                })
                .catch(function(error) {
                    console.error(error);
                });

        }
    }
})();
