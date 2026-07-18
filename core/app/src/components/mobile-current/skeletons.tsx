type MobileSkeletonKind = "activity" | "tasks" | "pages" | "apps" | "mail" | "page" | "app";

const repeated = (length: number) => Array.from({ length }, (_, index) => index);

export function MobileContentSkeleton({ kind }: { kind: MobileSkeletonKind }) {
  return <div className={`mobile-content-skeleton is-${kind}`} role="status" aria-label="正在加载内容">
    <div aria-hidden="true">
      {kind === "activity" ? <ActivitySkeleton /> : null}
      {kind === "tasks" ? <TaskListSkeleton /> : null}
      {kind === "pages" ? <PageGridSkeleton /> : null}
      {kind === "apps" ? <AppListSkeleton /> : null}
      {kind === "mail" ? <MailSkeleton /> : null}
      {kind === "page" ? <PageReaderSkeleton /> : null}
      {kind === "app" ? <AppHostSkeleton /> : null}
    </div>
  </div>;
}

export function MobileAboutSectionSkeleton() {
  return <section className="mobile-about-section mobile-about-section-skeleton" role="status" aria-label="正在加载内容">
    <div aria-hidden="true"><SkeletonLine className="heading" /><SkeletonLine /><SkeletonLine className="short" /><SkeletonLine /></div>
  </section>;
}

export function MobileAboutMachineSkeleton() {
  return <section className="mobile-about-machine mobile-about-machine-skeleton" role="status" aria-label="正在加载本机信息">
    <div aria-hidden="true"><SkeletonBlock className="mark" /><div><SkeletonLine className="meta" /><SkeletonLine className="title" /><SkeletonLine className="short" /></div><SkeletonLine className="state" /></div>
  </section>;
}

function ActivitySkeleton() {
  return <div className="mobile-skeleton-activity-list">{repeated(3).map((item) => <article key={item}>
    <SkeletonLine className="meta" /><SkeletonLine className="title" /><SkeletonLine /><SkeletonLine className="short" />
    {item === 0 ? <SkeletonBlock className="preview" /> : null}
  </article>)}</div>;
}

function TaskListSkeleton() {
  return <div className="mobile-skeleton-task-list">{repeated(4).map((item) => <article key={item}>
    <SkeletonBlock className="icon" /><div><SkeletonLine className="title" /><SkeletonLine /><SkeletonLine className="short" /></div><SkeletonLine className="time" />
  </article>)}</div>;
}

function PageGridSkeleton() {
  return <div className="mobile-skeleton-page-grid">{repeated(4).map((item) => <article className={`item-${item + 1}`} key={item}>
    <SkeletonBlock className="cover" /><SkeletonLine className="meta" /><SkeletonLine className="title" /><SkeletonLine className="short" />
  </article>)}</div>;
}

function AppListSkeleton() {
  return <div className="mobile-skeleton-app-list">{repeated(3).map((item) => <article key={item}>
    <SkeletonBlock className="icon" /><div><SkeletonLine className="title" /><SkeletonLine /><SkeletonLine className="short" /></div><SkeletonLine className="action" />
  </article>)}</div>;
}

function MailSkeleton() {
  return <article className="mobile-skeleton-mail"><SkeletonLine className="meta" /><SkeletonLine className="headline" /><SkeletonLine className="sender" />
    <div className="facts"><SkeletonLine /><SkeletonLine /></div>
    <div className="body">{repeated(5).map((item) => <SkeletonLine className={item === 2 || item === 4 ? "short" : ""} key={item} />)}</div>
  </article>;
}

function PageReaderSkeleton() {
  return <div className="mobile-skeleton-page-reader"><SkeletonBlock className="hero" /><SkeletonLine className="headline" /><SkeletonLine /><SkeletonLine className="short" /><div className="cards"><SkeletonBlock /><SkeletonBlock /></div></div>;
}

function AppHostSkeleton() {
  return <div className="mobile-skeleton-app-host"><div className="top"><SkeletonBlock className="mark" /><SkeletonLine className="title" /></div><SkeletonBlock className="hero" /><SkeletonLine /><SkeletonLine className="short" /><div className="cards"><SkeletonBlock /><SkeletonBlock /></div></div>;
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <i className={`mobile-skeleton-block ${className}`.trim()} />;
}

function SkeletonLine({ className = "" }: { className?: string }) {
  return <SkeletonBlock className={`mobile-skeleton-line ${className}`.trim()} />;
}
