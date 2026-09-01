import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

const DATA_URL = '/data/portfolio.json';

function ProjectSelector({ projects, selectedSlug, onSelect }) {
    return (
        <nav className="portfolio-app__projects" aria-label="프로젝트 선택">
            {projects.map((project, index) => {
                const selected = project.slug === selectedSlug;
                return (
                    <button
                        className="portfolio-app__project"
                        type="button"
                        key={project.slug}
                        aria-pressed={selected}
                        onClick={() => onSelect(project.slug)}
                    >
                        <span className="portfolio-app__project-index">0{index + 1}</span>
                        <span className="portfolio-app__project-copy">
                            <span className="portfolio-app__project-category">{project.categoryLabel}</span>
                            <strong>{project.title}</strong>
                        </span>
                        <span className="portfolio-app__project-arrow" aria-hidden="true">↗</span>
                    </button>
                );
            })}
        </nav>
    );
}

function CasePreview({ project, projectIndex }) {
    return (
        <section className="portfolio-app__preview" aria-live="polite">
            <div className="portfolio-app__preview-topline">
                <span>Case file / 0{projectIndex + 1}</span>
                <span>{project.period}</span>
            </div>
            <p className="portfolio-app__category">{project.categoryLabel}</p>
            <h1>{project.title}</h1>
            <p className="portfolio-app__summary">{project.summary}</p>

            <dl className="portfolio-app__facts">
                <div>
                    <dt>Role</dt>
                    <dd>{project.role}</dd>
                </div>
                <div>
                    <dt>Organization</dt>
                    <dd>{project.company}</dd>
                </div>
                <div>
                    <dt>Focus</dt>
                    <dd>{project.result}</dd>
                </div>
            </dl>

            <div className="portfolio-app__outcomes">
                <p>Public outcomes</p>
                <ul>
                    {project.outcomes.map((outcome) => <li key={outcome}>{outcome}</li>)}
                </ul>
            </div>

            <div className="portfolio-app__footer">
                <ul className="portfolio-app__stack" aria-label="사용 기술">
                    {project.stack.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <a className="portfolio-app__case-link" href={project.url}>
                    전체 사례 보기 <span aria-hidden="true">→</span>
                </a>
            </div>
        </section>
    );
}

function PortfolioApp() {
    const [projects, setProjects] = useState([]);
    const [selectedSlug, setSelectedSlug] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [error, setError] = useState(false);

    useEffect(() => {
        const inlineData = document.getElementById('work-data');
        let inlineProjects = null;
        try {
            inlineProjects = inlineData ? JSON.parse(inlineData.textContent || '') : null;
        } catch (_) {
            inlineProjects = null;
        }

        const projectsRequest = Array.isArray(inlineProjects) && inlineProjects.length
            ? Promise.resolve(inlineProjects)
            : fetch(DATA_URL).then((response) => {
                if (!response.ok) throw new Error('portfolio data failed');
                return response.json();
            });

        projectsRequest
            .then((data) => {
                setProjects(data);
                setSelectedSlug(data[0]?.slug || '');
            })
            .catch(() => setError(true));
    }, []);

    const categories = useMemo(
        () => [...new Map(projects.map((project) => [project.category, project.categoryLabel])).entries()],
        [projects],
    );
    const visibleProjects = useMemo(
        () => selectedCategory === 'all' ? projects : projects.filter((project) => project.category === selectedCategory),
        [projects, selectedCategory],
    );
    const selectedProject = visibleProjects.find((project) => project.slug === selectedSlug) || visibleProjects[0];

    function chooseCategory(category) {
        setSelectedCategory(category);
        const first = category === 'all' ? projects[0] : projects.find((project) => project.category === category);
        setSelectedSlug(first?.slug || '');
    }

    if (error) {
        return <p className="portfolio-app__message">프로젝트 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>;
    }
    if (!selectedProject) {
        return <p className="portfolio-app__message">프로젝트를 준비하고 있습니다.</p>;
    }

    return (
        <div className="portfolio-app">
            <div className="portfolio-app__masthead">
                <a className="portfolio-app__identity" href="/">YONGHYUN YOON <span>DATA ENGINEER</span></a>
                <a className="portfolio-app__resume" href="/resume/">Resume <span aria-hidden="true">↗</span></a>
            </div>

            <div className="portfolio-app__intro">
                <p>Selected work / 2024 — now</p>
                <h2>Building systems<br />that hold up.</h2>
                <span>운영 가능한 데이터 시스템을 설계한 사례</span>
            </div>

            <div className="portfolio-app__filters" aria-label="프로젝트 분야 필터">
                <button type="button" aria-pressed={selectedCategory === 'all'} onClick={() => chooseCategory('all')}>All work</button>
                {categories.map(([category, label]) => (
                    <button type="button" key={category} aria-pressed={selectedCategory === category} onClick={() => chooseCategory(category)}>{label}</button>
                ))}
            </div>

            <div className="portfolio-app__workspace">
                <ProjectSelector projects={visibleProjects} selectedSlug={selectedProject.slug} onSelect={setSelectedSlug} />
                <CasePreview project={selectedProject} projectIndex={projects.findIndex((project) => project.slug === selectedProject.slug)} />
            </div>
        </div>
    );
}

const root = document.getElementById('work-app');
if (root) createRoot(root).render(<PortfolioApp />);
