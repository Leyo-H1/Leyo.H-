"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { protectPortfolioVideo } from "@/lib/portfolio/media-protection";
import type { PortfolioProject } from "./portfolio";

export type SceneControls = { goTo: (index: number) => void };
type Props = {
  projects: PortfolioProject[];
  light: boolean;
  menuOpen: boolean;
  paused: boolean;
  onOpen: (index: number) => void;
  onReady: () => void;
  onHover: (index: number | null) => void;
  onActive: (index: number) => void;
  controlsRef: React.MutableRefObject<SceneControls | null>;
};

const vertex = `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main(){
    vUv=uv;
    vec4 world=modelMatrix*vec4(position,1.);
    vWorld=world.xyz;
    gl_Position=projectionMatrix*viewMatrix*world;
  }
`;
const screenFragment = `
  uniform sampler2D imageMap;
  uniform sampler2D titleMap;
  uniform float hover;
  uniform float time;
  uniform float lightMode;
  uniform float reflection;
  uniform float imageAspect;
  varying vec2 vUv;
  varying vec3 vWorld;
  float random(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
  void main(){
    vec2 uv=vUv;
    if(reflection>.5){
      float wave=sin(vWorld.y*.08+time*.8+sin(vWorld.x*.014)*2.);
      uv.x+=wave*.008+sin(vWorld.y*.19+time)*.003;
      uv.y+=sin(uv.x*35.+time)*.007;
    }
    float panelAspect=1.7777778;
    vec2 videoUv=uv;
    vec2 backgroundUv=uv;
    if(imageAspect<panelAspect){
      videoUv.x=(uv.x-.5)*panelAspect/imageAspect+.5;
      backgroundUv.y=(uv.y-.5)*imageAspect/panelAspect+.5;
    }else{
      videoUv.y=(uv.y-.5)*imageAspect/panelAspect+.5;
      backgroundUv.x=(uv.x-.5)*panelAspect/imageAspect+.5;
    }
    vec3 color=texture2D(imageMap,clamp(videoUv,0.,1.)).rgb;
    if(videoUv.x<0. || videoUv.x>1. || videoUv.y<0. || videoUv.y>1.){
      color=texture2D(imageMap,backgroundUv).rgb*.13;
    }
    float edge=1.-pow(abs(uv.x-.5)*1.4,2.);
    color*=mix(.66,.98,lightMode)*mix(.8,1.,edge);
    color*=1.-hover*.32;
    vec4 title=texture2D(titleMap,uv);
    color=mix(color,vec3(.973,.973,.914),title.a*hover);
    color+=(random(gl_FragCoord.xy+floor(time*18.))-.5)*.003;
    float distanceFade=smoothstep(-1450.,-120.,vWorld.z);
    float alpha=1.;
    if(reflection>.5){
      alpha=pow(1.-vUv.y,1.2)*mix(.34,.1,lightMode);
      color=mix(color,vec3(.025,.035,.042),.25*(1.-lightMode));
    }else{
      color=mix(mix(vec3(.008,.012,.015),vec3(.89),lightMode),color,mix(.65,1.,distanceFade));
    }
    gl_FragColor=vec4(color,alpha);
  }
`;
const backdropFragment = `
  uniform float time;
  uniform float lightMode;
  uniform vec2 resolution;
  varying vec2 vUv;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=noise(p)*a;p=p*2.02+vec2(1.7,9.2);a*=.5;}return v;}
  void main(){
    vec2 uv=vUv;
    vec2 p=uv*vec2(resolution.x/resolution.y,1.);
    float clouds=fbm(p*5.+vec2(-time*.014,time*.005));
    float mist=pow(clouds,2.3)*.65;
    float middle=exp(-pow((uv.y-.55)*2.4,2.));
    float beam=pow(max(0.,1.-abs(uv.x-.15-uv.y*.25)*2.),4.)*clouds*.027;
    vec3 dark=vec3(.002,.005,.007)+vec3(.58,.73,.8)*(mist*middle+beam);
    vec3 bright=vec3(.91)-vec3(clouds*.025);
    gl_FragColor=vec4(mix(dark,bright,lightMode),1.);
  }
`;
const postFragment = `
  uniform sampler2D sceneMap;
  uniform float time;
  uniform float lightMode;
  varying vec2 vUv;
  float random(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
  void main(){
    vec3 c=texture2D(sceneMap,vUv).rgb;
    float vig=smoothstep(.82,.15,distance(vUv,vec2(.5,.52)));
    c*=mix(mix(.25,1.,vig),mix(.96,1.,vig),lightMode);
    c+=(random(gl_FragCoord.xy+floor(time*24.))-.5)*.002;
    gl_FragColor=vec4(c,1.);
  }
`;

function curvedGeometry(radius: number, height: number, angle: number) {
  const geometry = new THREE.PlaneGeometry(1, 1, 96, 8);
  const p = geometry.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const theta = p.getX(i) * angle;
    p.setXYZ(i, radius * Math.sin(theta), p.getY(i) * height, radius * Math.cos(theta));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function updateRibbon(geometry: THREE.BufferGeometry, radius: number, height: number, arc: number, rotation: number) {
  const p = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < p.count; i++) {
    const theta = (uv.getX(i) - .5) * arc + rotation;
    let x = radius * Math.sin(theta);
    const z = radius * Math.cos(theta);
    // Fold the back of the cylinder outwards into a continuous, open ribbon.
    if (z < 0) x = Math.sign(x) * (2 * radius - Math.abs(x));
    p.setXYZ(i, x, (uv.getY(i) - .5) * height, z);
  }
  p.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function createTitleTexture(lines: string[]) {
  const canvas = document.createElement("canvas");
  canvas.width = 1800;
  canvas.height = 1012;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f8f8e9";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = 117;
  ctx.font = `400 ${size}px NeueMontreal, "PingFang SC", "Microsoft YaHei", sans-serif`;
  const maxWidth = Math.max(...lines.map(line => ctx.measureText(line.toUpperCase()).width));
  if (maxWidth > 1530) size *= 1530 / maxWidth;
  ctx.font = `400 ${size}px NeueMontreal, "PingFang SC", "Microsoft YaHei", sans-serif`;
  lines.forEach((line, i) => ctx.fillText(line, 900, 506 + (i - (lines.length - 1) / 2) * size * .95));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type Panel = {
  index: number;
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  mirror: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
  reflectedMaterial: THREE.ShaderMaterial;
  video: HTMLVideoElement;
  videoTexture: THREE.VideoTexture;
  poster: THREE.Texture;
  title: THREE.Texture;
};

export function GalleryScene(props: Props) {
  const { projects } = props;
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  useEffect(() => { live.current = props; }, [props]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let destroyed = false;
    let frameId = 0;
    let ready = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      container.dataset.fallback = "true";
      live.current.onReady();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-label", "三维影像作品墙。滚动或拖动浏览，点击画面播放完整影片。");
    renderer.domElement.setAttribute("role", "img");
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 10, 12000);
    const stage = new THREE.Group();
    scene.add(stage);
    const backdropScene = new THREE.Scene();
    const flatCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const backdropMaterial = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: backdropFragment,
      depthTest: false,
      uniforms: { time: { value: 0 }, lightMode: { value: 0 }, resolution: { value: new THREE.Vector2(1440, 900) } },
    });
    const flatGeometry = new THREE.PlaneGeometry(2, 2);
    backdropScene.add(new THREE.Mesh(flatGeometry, backdropMaterial));
    const renderTarget = new THREE.WebGLRenderTarget(1440, 900, { depthBuffer: true, samples: 4 });
    const postScene = new THREE.Scene();
    const postMaterial = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: postFragment,
      uniforms: { sceneMap: { value: renderTarget.texture }, time: { value: 0 }, lightMode: { value: 0 } },
      depthTest: false,
    });
    postScene.add(new THREE.Mesh(flatGeometry, postMaterial));
    renderer.autoClear = false;
    const loader = new THREE.TextureLoader();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(-10, -10);
    const mouse = new THREE.Vector2(0, 0);
    const panels: Panel[] = [];
    let width = container.clientWidth;
    let height = container.clientHeight;
    let radius = Math.min(width * .5, height);
    const count = projects.length;
    let panelHeight = radius * THREE.MathUtils.degToRad(58) / (16 / 9);
    let progress = 0;
    let target = 0;
    let lightValue = 0;
    let hoverIndex: number | null = null;
    let activeIndex = 0;
    let pointerInside = false;
    let lastInputTime = 0;
    let dragX: number | null = null;
    let dragDistance = 0;
    let lastTime = performance.now();
    let fontReady = false;
    const setHover = (index: number | null) => {
      if (hoverIndex === index) return;
      hoverIndex = index;
      live.current.onHover(index);
      container.style.cursor = index !== null ? "pointer" : "grab";
    };
    const frameMaterial = new THREE.MeshBasicMaterial({ color: "#161c20", side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    const buildGeometry = () => {
      radius = Math.min(width * .5, height);
      panelHeight = radius * THREE.MathUtils.degToRad(58) / (16 / 9);
      panels.forEach(panel => {
        panel.mesh.geometry.dispose();
        panel.mesh.geometry = curvedGeometry(radius, panelHeight, THREE.MathUtils.degToRad(58));
        panel.mirror.geometry = panel.mesh.geometry;
        const border = panel.group.children[2] as THREE.Mesh;
        border.geometry.dispose();
        border.geometry = curvedGeometry(radius - 1, panelHeight + 9, THREE.MathUtils.degToRad(58.5));
        panel.mirror.position.y = -panelHeight - 50;
        panel.group.position.set(0, height * .01, -radius);
      });
    };
    projects.forEach((project, index) => {
      const poster = loader.load(project.poster, () => {
        if (!ready && index === 0 && !destroyed) { ready = true; live.current.onReady(); }
      });
      poster.colorSpace = THREE.SRGBColorSpace;
      const video = document.createElement("video");
      protectPortfolioVideo(video);
      video.src = project.video;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = index < 2 || index === count - 1 ? "auto" : "metadata";
      const videoTexture = new THREE.VideoTexture(video);
      videoTexture.colorSpace = THREE.SRGBColorSpace;
      const title = createTitleTexture(project.titleLines);
      const material = new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: screenFragment,
        side: THREE.DoubleSide,
        transparent: true,
        uniforms: {
          imageMap: { value: poster }, titleMap: { value: title }, hover: { value: 0 },
          time: { value: 0 }, lightMode: { value: 0 }, reflection: { value: 0 },
          imageAspect: { value: project.width / project.height },
        },
      });
      const reflectedMaterial = material.clone();
      reflectedMaterial.uniforms.reflection.value = 1;
      reflectedMaterial.depthWrite = false;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
      mesh.userData.index = index;
      const mirror = new THREE.Mesh(new THREE.PlaneGeometry(), reflectedMaterial);
      mirror.scale.y = -1;
      const border = new THREE.Mesh(new THREE.PlaneGeometry(), frameMaterial);
      const group = new THREE.Group();
      group.add(mesh, mirror, border);
      stage.add(group);
      panels.push({ index, group, mesh, mirror, material, reflectedMaterial, video, videoTexture, poster, title });
    });
    void document.fonts.load("400 40px NeueMontreal").then(() => {
      if (destroyed) return;
      fontReady = true;
      panels.forEach((panel, i) => {
        panel.title.dispose();
        panel.title = createTitleTexture(projects[i].titleLines);
        panel.material.uniforms.titleMap.value = panel.title;
        panel.reflectedMaterial.uniforms.titleMap.value = panel.title;
      });
    });
    const resize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      renderer.setSize(width, height);
      renderTarget.setSize(width * renderer.getPixelRatio(), height * renderer.getPixelRatio());
      camera.aspect = width / height;
      const far = height / 2 / Math.tan(THREE.MathUtils.degToRad(15));
      camera.position.set(0, 0, far * .985);
      camera.updateProjectionMatrix();
      backdropMaterial.uniforms.resolution.value.set(width, height);
      buildGeometry();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    const onWheel = (event: WheelEvent) => {
      if (live.current.menuOpen || live.current.paused || count < 2) return;
      event.preventDefault();
      target += (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) / (radius * 1.0123);
      lastInputTime = performance.now();
    };
    const onPointerMove = (event: PointerEvent) => {
      pointerInside = true;
      pointer.set(event.clientX / width * 2 - 1, -(event.clientY / height) * 2 + 1);
      mouse.set(pointer.x, pointer.y);
      if (dragX !== null) {
        const dx = event.clientX - dragX;
        target -= dx / radius;
        dragDistance += Math.abs(dx);
        dragX = event.clientX;
        lastInputTime = performance.now();
      }
    };
    const onPointerLeave = () => { pointerInside = false; dragX = null; setHover(null); };
    const onPointerDown = (e: PointerEvent) => {
      if (live.current.menuOpen || live.current.paused || count < 2) return;
      dragX = e.clientX; dragDistance = 0;
      container.setPointerCapture(e.pointerId);
    };
    const onPointerUp = () => { dragX = null; };
    const onClick = () => {
      if (hoverIndex !== null && dragDistance < 5 && !live.current.menuOpen && !live.current.paused) live.current.onOpen(hoverIndex);
    };
    const onKey = (e: KeyboardEvent) => {
      if (live.current.menuOpen || live.current.paused || count < 2) return;
      if (["ArrowRight", "ArrowDown", "PageDown", "ArrowLeft", "ArrowUp", "PageUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        if (e.key === "Home") target = Math.round(progress / count) * count;
        else if (e.key === "End") target = Math.round(progress / count) * count + count - 1;
        else target = Math.round(target) + (["ArrowRight", "ArrowDown", "PageDown"].includes(e.key) ? 1 : -1);
        lastInputTime = performance.now();
      }
    };
    live.current.controlsRef.current = {
      goTo: index => {
        let distance = index - ((progress % count + count) % count);
        if (distance > count / 2) distance -= count;
        if (distance < -count / 2) distance += count;
        target = progress + distance;
        lastInputTime = performance.now();
      },
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerleave", onPointerLeave);
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    const animate = (now: number) => {
      if (destroyed) return;
      const dt = Math.min((now - lastTime) / 1000, .05);
      lastTime = now;
      const time = now / 1000;
      if (count > 1 && !live.current.menuOpen && !live.current.paused && now - lastInputTime > 1300 && dragX === null) target += dt * .0125;
      progress = THREE.MathUtils.damp(progress, target, 7, dt);
      lightValue = THREE.MathUtils.damp(lightValue, live.current.light ? 1 : 0, 5, dt);
      stage.rotation.x = THREE.MathUtils.damp(stage.rotation.x, mouse.y * .06, 2.5, dt);
      stage.rotation.y = THREE.MathUtils.damp(stage.rotation.y, mouse.x * -.045, 2.5, dt);
      const nearest = ((Math.round(progress) % count) + count) % count;
      if (nearest !== activeIndex) { activeIndex = nearest; live.current.onActive(nearest); }
      panels.forEach(panel => {
        const distance = ((panel.index - progress + count / 2) % count + count) % count - count / 2;
        panel.group.visible = Math.abs(distance) < 3;
        if (panel.group.visible) {
          updateRibbon(panel.mesh.geometry, radius, panelHeight, THREE.MathUtils.degToRad(58), distance * Math.PI / 3);
          const border = panel.group.children[2] as THREE.Mesh;
          updateRibbon(border.geometry, radius - 1, panelHeight + 9, THREE.MathUtils.degToRad(58.5), distance * Math.PI / 3);
        }
        const hovered = hoverIndex === panel.index && !live.current.menuOpen && !live.current.paused;
        const hoverValue = THREE.MathUtils.damp(panel.material.uniforms.hover.value, hovered && fontReady ? 1 : 0, 4, dt);
        if (panel.group.visible && Math.abs(distance) < 1.7 && !document.hidden && !live.current.paused) {
          if (panel.video.paused) void panel.video.play().catch(() => undefined);
        } else if (!panel.video.paused) panel.video.pause();
        const image = panel.video.readyState >= 2 ? panel.videoTexture : panel.poster;
        for (const mat of [panel.material, panel.reflectedMaterial]) {
          mat.uniforms.imageMap.value = image;
          mat.uniforms.hover.value = hoverValue;
          mat.uniforms.time.value = time;
          mat.uniforms.lightMode.value = lightValue;
        }
      });
      camera.updateMatrixWorld(); stage.updateMatrixWorld(true);
      if (pointerInside && !live.current.menuOpen && !live.current.paused && dragX === null) {
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(panels.filter(p => p.group.visible).map(p => p.mesh), false);
        setHover(hits.length ? hits[0].object.userData.index as number : null);
      } else if (live.current.menuOpen || live.current.paused) setHover(null);
      backdropMaterial.uniforms.time.value = time;
      backdropMaterial.uniforms.lightMode.value = lightValue;
      postMaterial.uniforms.time.value = time;
      postMaterial.uniforms.lightMode.value = lightValue;
      renderer.setRenderTarget(renderTarget);
      renderer.clear();
      renderer.render(backdropScene, flatCamera);
      renderer.clearDepth();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(postScene, flatCamera);
      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    const readyTimer = setTimeout(() => { if (!ready) live.current.onReady(); }, 5000);
    return () => {
      destroyed = true;
      clearTimeout(readyTimer);
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("keydown", onKey);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("click", onClick);
      panels.forEach(panel => {
        panel.video.pause(); panel.video.removeAttribute("src"); panel.video.load();
        panel.videoTexture.dispose(); panel.poster.dispose(); panel.title.dispose();
        panel.mesh.geometry.dispose(); panel.material.dispose(); panel.reflectedMaterial.dispose();
        (panel.group.children[2] as THREE.Mesh).geometry.dispose();
      });
      flatGeometry.dispose(); frameMaterial.dispose(); backdropMaterial.dispose(); postMaterial.dispose(); renderTarget.dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      live.current.controlsRef.current = null;
    };
  }, [projects]);

  return <div ref={host} className="gallery-canvas" style={{ position: "absolute", inset: 0 }}>
    <div className="webgl-fallback" style={{ backgroundImage: `url(${projects[0].poster})` }}>
      <button onClick={() => props.onOpen(0)}>{projects[0].title} · 播放影片</button>
    </div>
  </div>;
}
