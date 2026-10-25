/* eslint-disable react-hooks/refs, react-hooks/immutability, @next/next/no-img-element -- Supplied imperative animation engine: mutable RAF refs and local frame images, not render state. */
// Deck Carousel — Originkit

"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react"
import { animate } from "motion/react"
import type { Transition } from "motion/react"

type ImageInput = string | { src?: string } | null | undefined

export interface DeckCarouselCard {
    width?: number
    height?: number
    radius?: number
}

export interface DeckCarouselItem {
    image?: ImageInput

    offsetY?: number
}

export type DeckCarouselImage = ImageInput | DeckCarouselItem

export interface DeckCarouselProps {
    images?: DeckCarouselImage[]
    background?: string
    count?: number
    spacing?: number
    cardWidth?: number
    cardHeight?: number
    cardRadius?: number
    reach?: number
    scrollSensitivity?: number
    smoothing?: number
    transition?: Transition
    onSelect?: (index: number, origin: { left: number; top: number; width: number; height: number }) => void
    labels?: string[]
    style?: CSSProperties
}

const DEFAULT_CARD: Required<DeckCarouselCard> = {
    width: 180,
    height: 240,
    radius: 8,
}

const DEFAULT_TRANSITION: Transition = {
    type: "spring",
    stiffness: 120,
    damping: 18,
    mass: 1,
}

const DEFAULT_BACKGROUND = "#000000"
const DEFAULT_COUNT = 12
const DEFAULT_SPACING = 24
const DEFAULT_REACH = 5
const DEFAULT_SCROLL_SENSITIVITY = 5
const DEFAULT_SMOOTHING = 5

const DEFAULT_IMAGES: DeckCarouselItem[] = []

const CARD_PERSPECTIVE = 1000

const HOVER_LERP = 0.15

const STACK_SPREAD = 0.15

const STACK_TILT = 9

const STACK_HOLD = 0.55

const DEAL_STAGGER = 4.8 * 0.024

const DEAL_LIFT = 0.7

const TOUCH_GAIN = 2.2

const WHEEL_CLAMP = 400

const CARD_FILL = 0.9

const PLACEHOLDER_COUNT = 12

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

function wrap(value: number, span: number): number {
    return ((value % span) + span) % span
}

function wrapCentred(value: number, span: number): number {
    return wrap(value + span / 2, span) - span / 2
}

function noise(index: number, seed: number): number {
    const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453
    return value - Math.floor(value)
}

function resolveSrc(item: ImageInput): string | null {
    if (!item) return null
    if (typeof item === "string") return item || null
    const src = item.src
    return typeof src === "string" && src ? src : null
}

interface Slide {
    src: string | null

    offsetY: number
}

function resolveItem(entry: DeckCarouselImage): Slide {
    if (entry && typeof entry === "object" && "image" in entry) {
        const item = entry as DeckCarouselItem
        return {
            src: resolveSrc(item.image),
            offsetY: Number.isFinite(item.offsetY as number)
                ? (item.offsetY as number)
                : 0,
        }
    }
    return { src: resolveSrc(entry as ImageInput), offsetY: 0 }
}

function placeholderFill(index: number): string {
    const hue = (index * 47 + 210) % 360
    return `linear-gradient(150deg, hsl(${hue} 38% 30%), hsl(${
        (hue + 45) % 360
    } 52% 8%))`
}

interface CardState {
    deal: number

    layoutX: number
    currentRotation: number
    targetRotation: number

    jitterX: number
    jitterY: number
    jitterRotation: number
}

interface Scene {
    cards: CardState[]

    progressTarget: number
    progressCurrent: number

    dealt: boolean

    ready: boolean

    dirty: boolean
}

function makeCard(index: number, deal: number): CardState {
    return {
        deal,
        layoutX: 0,
        currentRotation: 0,
        targetRotation: 0,
        jitterX: noise(index, 1) * 2 - 1,
        jitterY: noise(index, 2) * 2 - 1,
        jitterRotation: noise(index, 3) * 2 - 1,
    }
}

function syncCards(scene: Scene, count: number): void {
    if (scene.cards.length === count) return
    const next: CardState[] = []
    for (let i = 0; i < count; i += 1) {
        next.push(scene.cards[i] ?? makeCard(i, scene.dealt ? 1 : 0))
    }
    scene.cards = next
}

interface Frame {
    count: number
    step: number
    period: number
    lapPx: number
    baseScale: number
    stackSpread: number
    dealLift: number
    hover: boolean
    hoverRadius: number
    falloff: number
    scrollLerp: number
    scrollPerLap: number
    transition: Transition
}

function BaseDeckCarousel({
    images = DEFAULT_IMAGES,
    background = DEFAULT_BACKGROUND,
    count = DEFAULT_COUNT,
    spacing = DEFAULT_SPACING,
    cardWidth = DEFAULT_CARD.width,
    cardHeight = DEFAULT_CARD.height,
    cardRadius = DEFAULT_CARD.radius,
    reach = DEFAULT_REACH,
    scrollSensitivity = DEFAULT_SCROLL_SENSITIVITY,
    smoothing = DEFAULT_SMOOTHING,
    transition,
    style,
    onSelect,
    labels = [],
}: DeckCarouselProps) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const stripRef = useRef<HTMLDivElement | null>(null)
    const cardRefs = useRef<(HTMLDivElement | null)[]>([])

    const [size, setSize] = useState({ width: 0, height: 0 })

    const [pointerFine, setPointerFine] = useState(false)

    const cardOpts = {
        width: cardWidth,
        height: cardHeight,
        radius: cardRadius,
    }

    const source = useMemo<Slide[]>(() => {
        const resolved = (images ?? [])
            .map(resolveItem)
            .filter((slide) => slide.src)
        return resolved.length
            ? resolved
            : Array.from({ length: PLACEHOLDER_COUNT }, () => ({
                  src: null,
                  offsetY: 0,
              }))
    }, [images])

    const cardCount = Math.max(1, Math.round(count))
    const step = cardOpts.width + Math.max(0, spacing)

    const baseScale =
        size.width > 0 && size.height > 0
            ? Math.max(
                  0.01,
                  Math.min(
                      1,
                      CARD_FILL *
                          Math.min(
                              size.width / cardOpts.width,
                              size.height / cardOpts.height
                          )
                  )
              )
            : 1

    const repeats = Math.max(
        1,
        Math.ceil(
            (size.width / baseScale + cardOpts.width) / (cardCount * step)
        ) || 1
    )
    const total = cardCount * repeats
    const period = total * step
    const lapPx = cardCount * step

    const scrollLerp = clamp(0.16 - clamp(smoothing, 0, 10) * 0.012, 0.03, 0.16)
    const scrollPerCard = 400 - clamp(scrollSensitivity, 0, 10) * 32
    const scrollPerLap = Math.max(1, scrollPerCard * cardCount)

    const hoverRadius = (100 + clamp(reach, 0, 10) * 80) * baseScale

    const dealTransition = transition ?? DEFAULT_TRANSITION

    const dealKey = useMemo(
        () => JSON.stringify(dealTransition),
        [dealTransition]
    )

    const scene = useRef<Scene>({
        cards: [],
        progressTarget: 0,
        progressCurrent: 0,
        dealt: false,
        ready: false,
        dirty: true,
    })

    const frame = useRef<Frame>({
        count: total,
        step,
        period,
        lapPx,
        baseScale,
        stackSpread: 0,
        dealLift: 0,
        hover: false,
        hoverRadius,
        falloff: 1,
        scrollLerp,
        scrollPerLap,
        transition: DEFAULT_TRANSITION,
    })
    frame.current = {
        count: total,
        step,
        period,
        lapPx,
        baseScale,
        stackSpread: STACK_SPREAD * Math.min(cardOpts.width, cardOpts.height),
        dealLift: DEAL_LIFT * cardOpts.height,
        hover: pointerFine,
        hoverRadius,
        falloff: Math.max(1, hoverRadius / 2),
        scrollLerp,
        scrollPerLap,
        transition: dealTransition,
    }

    scene.current.dirty = true

    useEffect(() => {
        const node = containerRef.current
        if (!node) return
        const observer = new ResizeObserver((entries) => {
            const rect = entries[0].contentRect
            setSize({ width: rect.width, height: rect.height })
        })
        observer.observe(node)
        setSize({ width: node.clientWidth, height: node.clientHeight })
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return
        const query = window.matchMedia("(hover: hover) and (pointer: fine)")
        const update = () => setPointerFine(query.matches)
        update()
        query.addEventListener("change", update)
        return () => query.removeEventListener("change", update)
    }, [])

    useEffect(() => {
        const state = scene.current
        state.dealt = false
        state.ready = false
        state.progressTarget = 0
        state.progressCurrent = 0
        for (const item of state.cards) item.deal = 0

        const running: { stop: () => void }[] = []
        let cancelled = false

        const start = () => {
            if (cancelled || state.dealt) return
            state.dealt = true

            syncCards(state, frame.current.count)
            const dealing = state.cards.length
            let landed = 0
            state.cards.forEach((item, index) => {
                item.deal = 0
                running.push(
                    animate(0, 1, {
                        ...frame.current.transition,
                        delay: STACK_HOLD + index * DEAL_STAGGER,
                        onUpdate: (value: number) => {
                            item.deal = value
                        },
                        onComplete: () => {
                            landed += 1
                            if (landed >= dealing) state.ready = true
                        },
                    })
                )
            })
        }

        const node = containerRef.current
        if (!node || typeof IntersectionObserver === "undefined") {
            start()
            return () => {
                cancelled = true
                running.forEach((controls) => controls.stop())
            }
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return
                observer.disconnect()
                start()
            },
            { threshold: 0, rootMargin: "0px 0px -15% 0px" }
        )
        observer.observe(node)
        return () => {
            cancelled = true
            observer.disconnect()
            running.forEach((controls) => controls.stop())
        }
    }, [dealKey])

    useEffect(() => {
        let raf = 0
        let last = 0

        const paint = () => {
            const config = frame.current
            const state = scene.current

            const strip = stripRef.current
            if (strip) strip.style.transform = `scale(${config.baseScale})`

            const travel = state.progressCurrent * config.lapPx

            const origin = (config.period - config.step) / 2

            for (let i = 0; i < state.cards.length; i += 1) {
                const node = cardRefs.current[i]
                if (!node) continue
                const item = state.cards[i]

                const slot = wrapCentred(
                    i * config.step - origin - travel,
                    config.period
                )
                item.layoutX = slot

                const settle = clamp(item.deal, 0, 1)
                const scatter = (1 - settle) * config.stackSpread
                const hop = config.dealLift * Math.sin(Math.PI * settle)

                const x = slot * item.deal + item.jitterX * scatter
                const y = item.jitterY * scatter - hop

                const spin = item.jitterRotation * STACK_TILT * (1 - settle)

                node.style.transform = `perspective(${CARD_PERSPECTIVE}px) translate3d(${x}px, ${y}px, 0) rotate(${spin}deg) rotateY(${item.currentRotation}deg)`
            }
        }

        const tick = (now: number) => {
            raf = requestAnimationFrame(tick)
            const dt = last ? Math.min(0.064, (now - last) / 1000) : 1 / 60
            last = now

            const config = frame.current
            const state = scene.current
            syncCards(state, config.count)

            const sk = 1 - Math.pow(1 - config.scrollLerp, dt * 60)
            state.progressCurrent +=
                (state.progressTarget - state.progressCurrent) * sk

            let moving = false
            if (
                Math.abs(state.progressTarget - state.progressCurrent) *
                    config.lapPx >
                0.02
            ) {
                moving = true
            } else {
                state.progressCurrent = state.progressTarget
            }

            if (state.progressCurrent >= 1) {
                state.progressCurrent -= 1
                state.progressTarget -= 1
            } else if (state.progressCurrent < 0) {
                state.progressCurrent += 1
                state.progressTarget += 1
            }

            const k = 1 - Math.pow(1 - HOVER_LERP, dt * 60)
            for (const item of state.cards) {
                const settle = clamp(item.deal, 0, 1)
                const aim = item.targetRotation * settle
                if (Math.abs(aim - item.currentRotation) > 0.01) {
                    item.currentRotation += (aim - item.currentRotation) * k
                    moving = true
                } else {
                    item.currentRotation = aim
                }
                if (item.deal !== 1) moving = true
            }

            if (moving || state.dirty) {
                state.dirty = false
                paint()
            }
        }

        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [])

    useEffect(() => {
        const node = containerRef.current
        if (!node) return
        const state = scene.current

        const advance = (deltaPx: number) => {
            state.progressTarget += deltaPx / frame.current.scrollPerLap
        }

        const onWheel = (event: WheelEvent) => {
            if (!state.ready) return
            let delta = event.deltaY
            if (event.deltaMode === 1) delta *= 16
            else if (event.deltaMode === 2) delta *= node.clientHeight || 800
            delta = clamp(delta, -WHEEL_CLAMP, WHEEL_CLAMP)
            event.preventDefault()
            advance(delta)
        }

        let touchY: number | null = null
        const onTouchStart = (event: TouchEvent) => {
            touchY = state.ready ? (event.touches[0]?.clientY ?? null) : null
        }
        const onTouchMove = (event: TouchEvent) => {
            const y = event.touches[0]?.clientY
            if (y == null || touchY == null) return
            const delta = clamp(
                (touchY - y) * TOUCH_GAIN,
                -WHEEL_CLAMP,
                WHEEL_CLAMP
            )
            touchY = y
            if (event.cancelable) event.preventDefault()
            advance(delta)
        }
        const onTouchEnd = () => {
            touchY = null
        }

        node.addEventListener("wheel", onWheel, { passive: false })
        node.addEventListener("touchstart", onTouchStart, { passive: true })
        node.addEventListener("touchmove", onTouchMove, { passive: false })
        node.addEventListener("touchend", onTouchEnd, { passive: true })
        node.addEventListener("touchcancel", onTouchEnd, { passive: true })
        return () => {
            node.removeEventListener("wheel", onWheel)
            node.removeEventListener("touchstart", onTouchStart)
            node.removeEventListener("touchmove", onTouchMove)
            node.removeEventListener("touchend", onTouchEnd)
            node.removeEventListener("touchcancel", onTouchEnd)
        }
    }, [])

    const handleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const config = frame.current
        const state = scene.current
        if (!config.hover) return
        const node = containerRef.current
        if (!node) return

        const rect = node.getBoundingClientRect()
        const centreX = rect.width / 2
        const centreY = rect.height / 2
        const pointerX = event.clientX - rect.left
        const pointerY = event.clientY - rect.top

        for (const item of state.cards) {
            const cardX = centreX + config.baseScale * item.layoutX
            const distance = Math.hypot(pointerX - cardX, pointerY - centreY)
            item.targetRotation =
                distance < config.hoverRadius
                    ? 180 * Math.max(0, 1 - distance / config.falloff)
                    : 0
        }
    }

    const handleLeave = () => {
        for (const item of scene.current.cards) item.targetRotation = 0
    }

    return (
        <div
            ref={containerRef}
            role="region"
            aria-label="作品卡片轮播"
            tabIndex={0}
            onKeyDown={event => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault()
                    scene.current.progressTarget += (event.key === "ArrowRight" ? 1 : -1) / cardCount
                }
            }}
            onPointerMove={handleMove}
            onPointerLeave={handleLeave}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                background,

                touchAction: "manipulation",
                ...style,
            }}
        >
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <div
                    ref={stripRef}
                    style={{
                        position: "relative",
                        width: 0,
                        height: 0,
                        transformOrigin: "center",
                        willChange: "transform",
                    }}
                >
                    {Array.from({ length: total }, (_, index) => {
                        const slide =
                            source[(index % cardCount) % source.length]
                        const src = slide?.src ?? null
                        return (
                            <div
                                key={index}
                                ref={(node) => {
                                    cardRefs.current[index] = node
                                }}
                                role="button"
                                tabIndex={0}
                                aria-label={`播放${labels[(index % cardCount) % source.length] ?? "影片"}`}
                                onClick={event => onSelect?.((index % cardCount) % source.length, event.currentTarget.getBoundingClientRect())}
                                onKeyDown={event => {
                                    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.((index % cardCount) % source.length, event.currentTarget.getBoundingClientRect()) }
                                }}
                                style={{
                                    position: "absolute",
                                    left: 0,
                                    top: 0,
                                    marginLeft: -cardOpts.width / 2,
                                    marginTop: -cardOpts.height / 2,
                                    width: cardOpts.width,
                                    height: cardOpts.height,
                                    borderRadius: cardOpts.radius,
                                    overflow: "hidden",
                                    transformOrigin: "center center",
                                    transformStyle: "preserve-3d",
                                    backfaceVisibility: "visible",
                                    willChange: "transform",

                                    zIndex: total - index,
                                    cursor: "pointer",
                                }}
                            >
                                {src ? (
                                    <img
                                        src={src}
                                        alt=""
                                        draggable={false}
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "cover",

                                            objectPosition: `50% calc(50% + ${
                                                slide?.offsetY ?? 0
                                            }px)`,
                                            display: "block",
                                            userSelect: "none",

                                            backfaceVisibility: "hidden",
                                        }}
                                    />
                                ) : (
                                    <div
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            background: placeholderFill(
                                                index % cardCount
                                            ),
                                            backfaceVisibility: "hidden",
                                        }}
                                    />
                                )}
                                {src && <img src={src} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "rotateY(180deg)", backfaceVisibility: "hidden" }} />}
                                <span className="deck-card-caption">{labels[(index % cardCount) % source.length]}</span>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

export function DeckCarousel(props: DeckCarouselProps) {
  return <BaseDeckCarousel {...props} transition={props.transition ?? DEFAULT_TRANSITION} />;
}