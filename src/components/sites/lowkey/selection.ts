import { projects } from "../aircord/portfolio";
import type { Collection, ShellKey } from "./data";

// Eight featured films plus six additional portrait covers in the orbit.
const selection: {slug:string;edge:string;spine:string;shell:ShellKey}[] = [
  {slug:"film-04",edge:"#a88b68",spine:"#4d3d30",shell:"smoked"},
  {slug:"film-02",edge:"#c7b0a1",spine:"#aa8f82",shell:"paleIce"},
  {slug:"film-06",edge:"#c0b8a6",spine:"#7d8d75",shell:"clear"},
  {slug:"film-05",edge:"#a46677",spine:"#663846",shell:"smoked"},
  {slug:"film-10",edge:"#d6c9a6",spine:"#bbaa83",shell:"milky"},
  {slug:"oolong",edge:"#c39a8e",spine:"#a8776b",shell:"clear"},
  {slug:"kunqu",edge:"#8eaa9b",spine:"#5f7d70",shell:"paleIce"},
  {slug:"diamond-iced-tea",edge:"#d8a5b2",spine:"#a47382",shell:"clear"},
];
export const selectedCollections: Collection[] = selection.map((setting,index)=>{
  const p=projects.find(item=>item.slug===setting.slug)!;
  const extraSlugs = ['film-03','film-08','film-09','film-12','film-13','film-16'];
  const extra = projects.find(item => item.slug === extraSlugs[index]);
  return {
    id:p.slug,slug:p.slug,titleZh:p.title,titleEn:p.title,year:p.year,
    category:"精选影像",medium:p.role,shell:setting.shell,
    palette:[setting.edge,setting.edge,setting.spine],materialPreset:"clear-acrylic",
    cover:p.poster,coverWorkId:p.slug,coverFit:"cover",coverFocus:[.5,.5],coverMatte:"transparent",coverZoom:1,
    videoSrc:p.fullVideo,
    frameTheme:{mode:"manual",edgeColor:setting.edge,spineColor:setting.spine,trayTone:"graphite",hardwareTone:"silver",colorIntensity:.78},
    descriptionZh:p.description,descriptionEn:p.description,status:"published",order:index+1,
    works:[{id:p.slug,image:p.poster,titleZh:p.title,titleEn:p.title,oneLineZh:p.description,oneLineEn:p.description,storyZh:p.description,storyEn:p.description,year:p.year,medium:p.role,order:1,presentation:{fit:"cover",focus:[.5,.5],matte:"transparent",zoom:1}}, ...(extra ? [{id:extra.slug,image:extra.poster,titleZh:extra.title,titleEn:extra.title,oneLineZh:extra.description,oneLineEn:extra.description,storyZh:extra.description,storyEn:extra.description,year:extra.year,medium:extra.role,order:2,presentation:{fit:'cover' as const,focus:[.5,.5] as [number,number],matte:'transparent' as const,zoom:1}}] : [])],
  };
});
