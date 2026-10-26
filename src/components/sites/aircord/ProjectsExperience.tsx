"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArchiveScene } from "../lowkey/ArchiveScene";
import { selectedCollections } from "../lowkey/selection";
import FlowingMenuSource from "./effects/FlowingMenu";
import { DeckCarousel } from "./effects/DeckCarousel";
import { CurvedGallery } from "./effects/CurvedGallery";
import { Volume2, VolumeX } from "lucide-react";
import { useInteractionSound } from "./useInteractionSound";
import { protectPortfolioVideo } from "@/lib/portfolio/media-protection";
import { PortfolioDialog, type PlayerOrigin } from "./PortfolioDialog";
import { categories, formatDuration, projects, type PortfolioProject } from "./portfolio";
import lightCoverMap from "./light-cover-map.json";
import "./experience.css";


function previewCover(poster: string, theme: "light" | "dark") {
  return theme === "light" ? (lightCoverMap as Record<string, string>)[poster] ?? poster : poster;
}

// Keep the supplied JS animation engines intact with typed integration boundaries.
type MenuItem = { text: string; image: string; meta: string };
const FlowingMenu = FlowingMenuSource as unknown as ComponentType<{
  items: MenuItem[]; bgColor: string; textColor: string; borderColor: string; marqueeBgColor: string; marqueeTextColor: string;
  align: string; showIndex: boolean; showArrow: boolean; direction: string; ariaLabel: string;
  onItemClick: (item: MenuItem, index: number) => void;
}>;
type View = "intro" | "categories" | "collection";
const mobileQuery = "(max-width:700px) and (orientation:portrait)";
const subscribeMobile = (change: () => void) => {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};

export function ProjectsExperience() {
  const [view, setView] = useState<View>("intro");
  const [category, setCategory] = useState<string>(categories[0]);
  const [playing, setPlaying] = useState<PortfolioProject | null>(null);
  const [playerOrigin, setPlayerOrigin] = useState<PlayerOrigin>();
  const [playerBusy, setPlayerBusy] = useState(false);
  const mobilePortrait = useSyncExternalStore(subscribeMobile, () => window.matchMedia(mobileQuery).matches, () => false);
  const heading = useRef<HTMLHeadingElement>(null);
  const main = useRef<HTMLElement>(null);
  const theme = "light";
  const reducedMotion = useReducedMotion() ?? false;
  const fade = { duration: reducedMotion ? 0 : 0.22, ease: "easeInOut" as const };
  const background = theme === "light" ? "#ffffff" : "#000000";
  const foreground = theme === "light" ? "#000000" : "#ffffff";
  const showCategories = useCallback(() => {
    if (mobilePortrait) window.dispatchEvent(new CustomEvent("portfolio-catalogue-enter"));
    else setView("categories");
  }, [mobilePortrait]);
  const collection = useMemo(() => projects.filter(p => p.category === category), [category]);
  const menuItems = useMemo(() => categories.map(name => ({
    text: name,
    image: previewCover(name === "社媒物料" ? projects.find(p => p.title === "牛乳与茶汤")!.poster : name === "餐饮美食" ? "/portfolio/media/menu-food.jpg" : projects.find(p => p.category === name)!.poster, theme),
    meta: `${String(projects.filter(p => p.category === name).length).padStart(2, "0")} 部`,
  })), [theme]);
  const images = useMemo(() => collection.map(p => previewCover(p.poster, theme)), [collection, theme]);
  const labels = useMemo(() => collection.map(p => p.title), [collection]);
  const portrait = category === "茶饮烘焙" || category === "社媒物料";
  const sounds = useInteractionSound(main, theme === "light", `${view}:${category}:${playing?.slug ?? ""}`, playerBusy);
  function openCategory(index: number) { setCategory(categories[index]); setView("collection"); }
  function adjacent(direction: number) {
    const index = collection.findIndex(p => p.slug === playing?.slug);
    setPlayerOrigin(undefined);
    setPlaying(collection[(index + direction + collection.length) % collection.length]);
  }
  function selectProject(index: number, origin: PlayerOrigin) {
    setPlayerOrigin(theme === "light" ? origin : undefined);
    setPlayerBusy(true);
    setPlaying(collection[index]);
  }
  const catalogue = <>
    <header className="cinema-header"><button className="cinema-back" onClick={() => window.dispatchEvent(new CustomEvent("portfolio-catalogue-return"))}>← 返回精选</button></header>
    <section className="categories-screen" aria-labelledby="mobile-categories-heading">
      <div className="collection-heading"><h1 id="mobile-categories-heading" tabIndex={-1}>全部作品</h1></div>
      <div className="flowing-frame"><nav className="quiet-menu" aria-label="全部作品分类">{menuItems.map((item, index) => <button className="quiet-menu-row" key={item.text} onClick={() => openCategory(index)}><span className="quiet-menu-index">{String(index + 1).padStart(2, "0")}</span><span className="flowing-menu__label-text">{item.text}</span><span className="quiet-menu-meta">{item.meta}</span><span className="quiet-menu-arrow" aria-hidden="true">↗</span></button>)}</nav></div>
    </section>
  </>;
  const mobileArchive = mobilePortrait && view !== "collection";
  return <main ref={main} className="cinema" data-view={view} data-theme={theme} data-player-open={!!playing}>
    {theme === "light" && <button className="cinema-sound" onClick={sounds.toggle} aria-label={sounds.soundOn ? "关闭界面音效" : "开启界面音效"} aria-pressed={sounds.soundOn} inert={playerBusy}>{sounds.soundOn ? <Volume2 size={15} strokeWidth={1.3} /> : <VolumeX size={15} strokeWidth={1.3} />}</button>}
    <AnimatePresence mode="wait" initial={false}>
      <motion.div className="cinema-view" key={mobileArchive ? "mobile-archive" : view === "collection" ? `collection-${category}` : view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} onAnimationComplete={() => heading.current?.focus({ preventScroll: true })}>
        {view === "intro" || mobileArchive ? <ArchiveScene key={theme} series={selectedCollections} reducedMotion={reducedMotion} entranceMode="orbit" theme={theme} onMore={showCategories} onMotion={sounds.motion} onMotionEnd={sounds.endMotion} onFeedback={sounds.feedback} catalogue={mobilePortrait ? catalogue : undefined} startInCategories={mobileArchive && view === "categories"} /> : <>
          <header className="cinema-header" inert={playerBusy}>
            {theme !== "light" && <><button className="cinema-brand" onClick={() => setView("intro")} aria-label="返回首页">影像<span>·</span></button>
            <span className="cinema-subtitle">视频摄影 · 作品集</span></>}
            <button className="cinema-back" onClick={() => setView(view === "collection" ? "categories" : "intro")}>← {view === "collection" ? "返回分类" : "返回精选"}</button>
          </header>
          {view === "categories" && <section className="categories-screen" inert={!!playing} aria-labelledby="categories-heading">
            <div className="collection-heading"><h1 id="categories-heading" ref={heading} tabIndex={-1}>全部作品</h1><p>{projects.length} 部影像 · 选择一个视角</p></div>
            <div className="flowing-frame">{theme === "light" ? <nav className="quiet-menu" aria-label="全部作品分类">{menuItems.map((item, index) => <button className="quiet-menu-row" key={item.text} onClick={() => openCategory(index)}><span className="quiet-menu-index">{String(index + 1).padStart(2, "0")}</span><span className="flowing-menu__label-text">{item.text}</span><span className="quiet-menu-meta">{item.meta}</span><span className="quiet-menu-arrow" aria-hidden="true">↗</span></button>)}</nav> : <FlowingMenu items={menuItems} textColor={foreground} borderColor="#ffffff40" bgColor={background} marqueeBgColor={background} marqueeTextColor={foreground} align="left" showIndex showArrow direction="alternate" ariaLabel="全部作品分类" onItemClick={(_, index) => openCategory(index)} />}</div>
            <p className="cinema-bottom-note">移动光标探索 · 点击进入作品</p>
          </section>}
          {view === "collection" && <section className="collection-screen" data-format={portrait ? "portrait" : "landscape"} inert={playerBusy} aria-labelledby="collection-heading">
            <div className="collection-heading"><div><p className="cinema-eyebrow">作品集 / {String(categories.indexOf(category as typeof categories[number]) + 1).padStart(2, "0")}</p><h1 id="collection-heading" ref={heading} tabIndex={-1}>{category}</h1></div>{theme !== "light" && <p>{collection.length} 部作品</p>}</div>
            <div className="deck-stage" data-format={portrait ? "portrait" : "landscape"}>{theme === "light" ? <CurvedGallery key={category} images={images} labels={labels} portrait={portrait} paused={playerBusy} reducedMotion={reducedMotion} onSelect={selectProject} onFeedback={sounds.feedback} onMotion={sounds.motion} onMotionEnd={sounds.endMotion} /> : <DeckCarousel key={category} images={images} labels={labels} count={collection.length} background={background} cardWidth={portrait ? 270 : 560} cardHeight={portrait ? 480 : 315} cardRadius={8} spacing={28} reach={5} onSelect={selectProject} />}</div>
            <footer className="collection-footer">{theme !== "light" && <p>滚动浏览 · 悬停翻转 · 点击放大播放</p>}<div><button onClick={() => openCategory((categories.indexOf(category as typeof categories[number]) + categories.length - 1) % categories.length)}>← 上个分类</button><button onClick={() => openCategory((categories.indexOf(category as typeof categories[number]) + 1) % categories.length)}>下个分类 →</button></div></footer>
          </section>}
        </>}
      </motion.div>
    </AnimatePresence>
    <AnimatePresence onExitComplete={() => setPlayerBusy(false)}>
      {playing && <PortfolioDialog key="player" theme={theme} origin={playerOrigin} aspect={playing.width / playing.height} portrait={playing.width < playing.height} poster={previewCover(playing.poster, theme)} label={`正在播放：${playing.title}`} onDismiss={() => setPlaying(null)}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={playing.slug} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
            <header className="player-heading"><div><p>{playing.year} · {formatDuration(playing.duration)}</p><h2>{playing.title}</h2></div><button className="dialog-close" aria-label="关闭影片" onClick={() => setPlaying(null)}>×</button></header>
            <video ref={protectPortfolioVideo} className="portfolio-player" src={playing.fullVideo} poster={playing.poster} controls controlsList="nodownload" draggable={false} autoPlay playsInline preload="metadata" aria-label={playing.title} />
            <footer className="player-details"><div>{playing.role && <p><span>我的职责</span>{playing.role}</p>}{playing.description && <p className="film-description">{playing.description}</p>}</div><div className="player-pagination"><button onClick={() => adjacent(-1)}>← 上一部</button><button onClick={() => adjacent(1)}>下一部 →</button></div></footer>
          </motion.div>
        </AnimatePresence>
      </PortfolioDialog>}
    </AnimatePresence>
  </main>;
}
