import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Filter, SlidersHorizontal, Star, Waves, Ruler, Layers, Columns2, PlusSquare, X, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/**
 * Production-lean homepage with cross-shaper recommendations.
 * Data sources (zero-cost):
 * - "github": raw JSON hosted on a public GitHub repo
 * - "airtable": CSV from an Airtable shared view (no API key)
 */
const DATA_SOURCE: "github" | "airtable" = "github";
const GITHUB_JSON_URL = "https://github.com/DJenkin82/Surfboard-Finder/blob/main/Surfboard%20Finder.txt"; // HTML URL is OK — auto-converted to raw
const AIRTABLE_CSV_URL = "https://airtable.com/shrXXXXXXXXXXXXXX/tblXXXXXXXXXXXXXX/viwXXXXXXXXXXXXXX.csv"; // replace with your shared CSV link

export type Ability = "beginner" | "intermediate" | "advanced";
export type WaveType = "small_beach" | "mellow_point" | "punchy_reef" | "overhead";
export interface Board {
  id: string;
  shaper: string;
  model: string;
  waveTypes: WaveType[];
  abilities: Ability[];
  recommendedWeight: [number, number];
  length: string;
  volume: number;
  tail: string;
  fins: string;
  construction: string;
  img: string;
  sponsored?: boolean;
}

const WAVE_TYPES = [
  { value: "small_beach", label: "Small Beachies" },
  { value: "mellow_point", label: "Point Breaks" },
  { value: "punchy_reef", label: "Punchy Reefs" },
  { value: "overhead", label: "Overhead / Hollow" },
] as const;

const ABILITIES = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
] as const;

// Fallback (used when remote fetch fails)
const FALLBACK_BOARDS: Board[] = [
  { id: "js-monsta-2024", shaper: "JS Industries", model: "Monsta 2024", waveTypes: ["small_beach","mellow_point","punchy_reef"], abilities: ["intermediate","advanced"], recommendedWeight: [65,95], length: "6'0\"", volume: 31.5, tail: "Squash", fins: "Thruster / 5-fin", construction: "PU/PE", img: "https://images.unsplash.com/photo-1544551763-7ef420b9b04c?q=80&w=1200&auto=format&fit=crop" },
  { id: "ci-happy-everyday", shaper: "Channel Islands", model: "Happy Everyday", waveTypes: ["small_beach","mellow_point"], abilities: ["beginner","intermediate"], recommendedWeight: [55,90], length: "5'10\"", volume: 30.3, tail: "Rounded Squash", fins: "Thruster / Quad", construction: "PU/PE / Spine-Tek", img: "https://images.unsplash.com/photo-1540932239986-30128078f3c5?q=80&w=1200&auto=format&fit=crop", sponsored: true },
  { id: "pyzel-ghost", shaper: "Pyzel", model: "Ghost", waveTypes: ["punchy_reef","overhead"], abilities: ["intermediate","advanced"], recommendedWeight: [70,105], length: "6'2\"", volume: 32.8, tail: "Round", fins: "Thruster", construction: "PU/PE / Epoxy", img: "https://images.unsplash.com/photo-1496545672447-f699b503d270?q=80&w=1200&auto=format&fit=crop" },
];

// ————— Logic helpers —————
function round1(n:number){ return Math.round(n*10)/10; }
function heuristicVolume(weightKg: number, ability: Ability){
  const mult = { beginner: [0.45,0.55], intermediate: [0.38,0.47], advanced: [0.3,0.4] } as const;
  const [a,b] = mult[ability];
  return [round1(weightKg*a), round1(weightKg*b)] as const;
}
function scoreBoard(b: Board, weight: number, wave: WaveType, ability: Ability){
  const [minV,maxV] = heuristicVolume(weight, ability);
  const targetV = (minV+maxV)/2;
  const volDiff = Math.abs(b.volume - targetV);
  let s = 100 - Math.min(volDiff,40)*1.5; // volume closeness
  if (b.waveTypes.includes(wave)) s += 10;
  if (b.abilities.includes(ability)) s += 8;
  const [wMin,wMax] = b.recommendedWeight;
  if (weight>=wMin && weight<=wMax) s += 6; else s -= 6;
  if (b.sponsored) s += 3; // light nudge
  return s;
}
function normalizeGithubRaw(url:string){
  return /github\.com\/.+\/blob\//.test(url)
    ? url.replace("https://github.com/","https://raw.githubusercontent.com/").replace("/blob/","/")
    : url;
}
function safeParseCSVRow(line: string, expected: number): string[] | null {
  const out: string[] = []; let cur = ""; let inQ=false;
  for (let i=0;i<line.length;i++){ const ch=line[i]; if(ch==='"'){ inQ=!inQ; continue; } if(ch===',' && !inQ){ out.push(cur); cur=""; continue; } cur+=ch; }
  out.push(cur); return out.length>=expected? out : null;
}
function parseAirtableCSV(csv: string): Board[] {
  const rows = csv.split(/\r?\n/).filter(Boolean); if(!rows.length) return [];
  const headers = rows[0].split(",").map(h=>h.trim()); const idx=(k:string)=>headers.indexOf(k);
  const out: Board[] = [];
  for(let i=1;i<rows.length;i++){
    const cols = safeParseCSVRow(rows[i], headers.length); if(!cols) continue;
    const wave = (cols[idx("waveTypes")]||"").replaceAll(" ","");
    const abil = (cols[idx("abilities")]||"").replaceAll(" ","");
    const sponsoredRaw = (cols[idx("sponsored")]||"").toLowerCase();
    out.push({
      id: cols[idx("id")] || `${(cols[idx("shaper")]||"")}-${(cols[idx("model")]||i)}`.toLowerCase().replace(/\s+/g,"-"),
      shaper: cols[idx("shaper")]||"",
      model: cols[idx("model")]||"",
      waveTypes: wave? (wave.includes("|")? wave.split("|") : wave.split(",")) as WaveType[] : [],
      abilities: abil? (abil.includes("|")? abil.split("|") : abil.split(",")) as Ability[] : [],
      recommendedWeight: [Number(cols[idx("recommendedWeightMin")]||0), Number(cols[idx("recommendedWeightMax")]||0)],
      length: cols[idx("length")]||"",
      volume: Number(cols[idx("volume")]||0),
      tail: cols[idx("tail")]||"",
      fins: cols[idx("fins")]||"",
      construction: cols[idx("construction")]||"",
      img: cols[idx("img")]||"",
      sponsored: ["1","true","yes","y"].includes(sponsoredRaw),
    });
  }
  return out;
}

// ————— Page —————
export default function SurfboardFinderProCompare(){
  const [weight, setWeight] = useState<number|string>(80);
  const [ability, setAbility] = useState<Ability>("intermediate");
  const [wave, setWave] = useState<WaveType>("mellow_point");
  const [sort, setSort] = useState<"best"|"volume"|"sponsored">("best");
  const [selectedShapers, setSelectedShapers] = useState<string[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [openCompare, setOpenCompare] = useState(false);

  const [boards, setBoards] = useState<Board[]|null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);

  useEffect(()=>{
    let cancelled=false;
    async function load(){
      setIsLoading(true); setError(null);
      try{
        const data = DATA_SOURCE === "airtable"
          ? await (async()=>{ const r=await fetch(AIRTABLE_CSV_URL,{cache:"no-store"}); if(!r.ok) throw new Error(`Airtable ${r.status}`); return parseAirtableCSV(await r.text()); })()
          : await (async()=>{ const url=normalizeGithubRaw(GITHUB_JSON_URL); const r=await fetch(url,{cache:"no-store"}); if(!r.ok) throw new Error(`GitHub ${r.status}`); return await r.json(); })();
        if(!cancelled) setBoards(data);
      }catch(e:any){
        console.warn("Falling back to local sample:", e?.message);
        if(!cancelled){ setBoards(FALLBACK_BOARDS); setError(`Using sample data (${DATA_SOURCE} fetch failed)`); }
      }finally{ if(!cancelled) setIsLoading(false); }
    }
    load();
    return ()=>{cancelled=true};
  },[]);

  const [minV,maxV] = heuristicVolume(Number(weight||0), ability);
  const enriched = useMemo(()=> (boards||[]).map(b=> ({...b, _score: scoreBoard(b, Number(weight||0), wave, ability)})), [boards, weight, wave, ability]);
  const allShapers = useMemo(()=> Array.from(new Set(enriched.map(b=>b.shaper))).sort(), [enriched]);

  const filtered = useMemo(()=>{
    let list = enriched
      .filter(b=> b.waveTypes.includes(wave))
      .filter(b=> b.abilities.includes(ability))
      .filter(b=> b.volume >= minV - 6 && b.volume <= maxV + 6);
    if(selectedShapers.length) list = list.filter(b=> selectedShapers.includes(b.shaper));
    switch (sort){
      case "volume": {
        const target=(minV+maxV)/2; return list.sort((a,b)=> Math.abs(a.volume-target)-Math.abs(b.volume-target));
      }
      case "sponsored": return list.sort((a,b)=> Number(!!b.sponsored)-Number(!!a.sponsored));
      default: return list.sort((a,b)=> (b as any)._score - (a as any)._score);
    }
  }, [enriched, wave, ability, minV, maxV, sort, selectedShapers]);

  const topPicksByShaper = useMemo(()=>{
    const by = new Map<string, any[]>();
    for(const b of filtered){ if(!by.has(b.shaper)) by.set(b.shaper, []); by.get(b.shaper)!.push(b); }
    const tops = Array.from(by.entries()).map(([shaper, arr])=> ({ shaper, board: arr.sort((a,b)=> (b as any)._score - (a as any)._score)[0] }));
    return tops.sort((a,b)=> (b.board as any)._score - (a.board as any)._score);
  }, [filtered]);

  const toggleCompare = (id:string)=> setCompareIds(prev=> prev.includes(id) ? prev.filter(x=>x!==id) : prev.length<4 ? [...prev,id] : prev);
  const selectedBoards = (boards||[]).filter(b=> compareIds.includes(b.id));
  const toggleShaper = (s:string)=> setSelectedShapers(prev=> prev.includes(s) ? prev.filter(x=>x!==s) : [...prev, s]);

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3"><Waves className="h-6 w-6"/><span className="font-semibold tracking-tight">Surfboard Finder</span></div>
          <nav className="hidden md:flex items-center gap-6 text-sm text-neutral-600">
            <a className="hover:text-neutral-900" href="#finder">Finder</a>
            <a className="hover:text-neutral-900" href="#compare">Compare</a>
            <a className="hover:text-neutral-900" href="#shapers">Shapers</a>
            <a className="hover:text-neutral-900" href="#articles">Guides</a>
          </nav>
        </div>
      </header>

      {/* Finder */}
      <section id="finder" className="relative overflow-hidden">
        <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:0.6}} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid lg:grid-cols-4 gap-8 items-start">
            <div className="lg:col-span-3">
              <Card className="border-0 shadow-none">
                <CardHeader className="p-0 pb-6"><TopBannerAd/></CardHeader>
                <CardContent className="p-0 pt-6">
                  <div className="grid md:grid-cols-2 gap-8 items-center">
                    <div>
                      <h1 className="text-3xl md:text-5xl font-semibold tracking-tight leading-tight">Compare shapers’ <span className="underline decoration-neutral-300">top recommendations</span></h1>
                      <p className="mt-4 text-neutral-600 max-w-prose">Enter your weight, wave type, and ability. We’ll compute best matches and show each shaper’s top pick so you can compare across brands — fast.</p>
                    </div>
                    <div>
                      <Card className="rounded-2xl border-neutral-200">
                        <CardHeader className="pb-2"><CardTitle className="text-base font-medium flex items-center gap-2"><SlidersHorizontal className="h-4 w-4"/>Quick Finder</CardTitle></CardHeader>
                        <CardContent className="grid gap-4">
                          <div className="grid gap-2"><Label htmlFor="weight">Weight (kg)</Label><Input id="weight" type="number" min={35} max={130} value={weight} onChange={(e)=>setWeight(e.target.value)} /><p className="text-xs text-neutral-500">Suggested volume: <strong>{minV}–{maxV} L</strong></p></div>
                          <div className="grid gap-2"><Label>Wave Type</Label>
                            <Select value={wave} onValueChange={(v:WaveType)=>setWave(v)}>
                              <SelectTrigger><SelectValue placeholder="Select wave"/></SelectTrigger>
                              <SelectContent>{WAVE_TYPES.map(w=> <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2"><Label>Ability</Label>
                            <Select value={ability} onValueChange={(v:Ability)=>setAbility(v)}>
                              <SelectTrigger><SelectValue placeholder="Select ability"/></SelectTrigger>
                              <SelectContent>{ABILITIES.map(a=> <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-center gap-3">
                            <SortSelect sort={sort} setSort={setSort}/>
                            <Button className="flex-1" onClick={()=>{ document.getElementById('results')?.scrollIntoView({behavior:'smooth'}); }}><Search className="h-4 w-4 mr-2"/>Find matches</Button>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            <aside className="hidden lg:block"><SidebarAd/></aside>
          </div>
        </motion.div>
      </section>

      {/* Results */}
      <section id="results" className="border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3 space-y-6">
            {error && <div className="text-xs text-amber-600">{error}</div>}

            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2"><Sparkles className="h-5 w-5"/>Recommendations</h2>
              <div className="text-sm text-neutral-500">{isLoading? "Loading…" : `${filtered.length} matches · ${topPicksByShaper.length} shapers`}</div>
            </div>

            {/* Shaper chips */}
            <div className="flex gap-2 flex-wrap">
              {allShapers.map(s=> (
                <button key={s} onClick={()=>toggleShaper(s)} className={`px-3 py-1 rounded-full border text-sm ${selectedShapers.includes(s)? 'bg-black text-white border-black' : 'hover:bg-neutral-50'}`}>{s}</button>
              ))}
              {selectedShapers.length>0 && <button onClick={()=>setSelectedShapers([])} className="px-3 py-1 rounded-full border text-sm hover:bg-neutral-50">Clear</button>}
            </div>

            <Tabs defaultValue="top">
              <TabsList>
                <TabsTrigger value="top">Top Picks by Shaper</TabsTrigger>
                <TabsTrigger value="all">All Matches</TabsTrigger>
              </TabsList>

              <TabsContent value="top">
                {isLoading ? <SkeletonGrid/> : topPicksByShaper.length ? (
                  <div className="grid sm:grid-cols-2 gap-6">
                    {topPicksByShaper.map(({shaper, board})=> (
                      <BoardCard key={board.id} board={board} compareIds={compareIds} toggleCompare={toggleCompare} badgeLeft={`${shaper} · Top Pick`} score={Math.round((board as any)._score)} />
                    ))}
                  </div>
                ) : <EmptyState/>}
              </TabsContent>

              <TabsContent value="all">
                {isLoading ? <SkeletonGrid/> : filtered.length ? (
                  <div className="grid sm:grid-cols-2 gap-6">
                    {filtered.map((b)=> (
                      <BoardCard key={b.id} board={b} compareIds={compareIds} toggleCompare={toggleCompare} score={Math.round((b as any)._score)} />
                    ))}
                  </div>
                ) : <EmptyState/>}
              </TabsContent>
            </Tabs>

            <InFeedAd/>
          </div>
          <aside className="hidden lg:block"><SidebarAd/></aside>
        </div>
      </section>

      {/* Compare Drawer */}
      <AnimatePresence>
        {compareIds.length>0 && (
          <motion.div initial={{y:100,opacity:0}} animate={{y:0,opacity:1}} exit={{y:100,opacity:0}} transition={{type:"spring",stiffness:260,damping:25}} className="fixed bottom-4 left-0 right-0 z-50">
            <div className="max-w-4xl mx-auto bg-white border shadow-xl rounded-2xl p-3 md:p-4 flex items-center gap-3">
              <ComparePreview compareIds={compareIds} boards={boards||[]} onRemove={(id)=> setCompareIds(prev=>prev.filter(x=>x!==id))} />
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={()=>setCompareIds([])}>Clear</Button>
                <Button onClick={()=>setOpenCompare(true)}>Open Compare ({compareIds.length})</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Compare modal */}
      <Dialog open={openCompare} onOpenChange={setOpenCompare}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Compare Boards</DialogTitle>
            <DialogDescription>Up to four boards, side by side.</DialogDescription>
          </DialogHeader>
          <CompareTable boards={selectedBoards as any} />
        </DialogContent>
      </Dialog>

      <footer className="border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid md:grid-cols-3 gap-8">
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-semibold"><Waves className="h-5 w-5"/> Surfboard Finder</div>
            <p className="text-sm text-neutral-600">Modern, minimal surfboard comparison. Built for surfers, supported by sponsors.</p>
          </div>
          <div className="text-sm text-neutral-600">
            <div className="font-semibold mb-2">For Advertisers</div>
            <ul className="space-y-1">
              <li>Top banner (970×250 / responsive)</li>
              <li>Sidebar (300×600)</li>
              <li>In-feed native placements</li>
            </ul>
          </div>
          <div className="text-sm text-neutral-600">
            <div className="font-semibold mb-2">Links</div>
            <ul className="space-y-1">
              <li><a className="hover:text-neutral-900" href="#">About</a></li>
              <li><a className="hover:text-neutral-900" href="#">Contact</a></li>
              <li><a className="hover:text-neutral-900" href="#">Guides</a></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SortSelect({sort, setSort}:{sort:"best"|"volume"|"sponsored"; setSort:(v:any)=>void}){
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-neutral-600">Sort</span>
      <Select value={sort} onValueChange={(v)=>setSort(v)}>
        <SelectTrigger className="w-40"><SelectValue placeholder="Best match"/></SelectTrigger>
        <SelectContent>
          <SelectItem value="best">Best match</SelectItem>
          <SelectItem value="volume">Volume closest</SelectItem>
          <SelectItem value="sponsored">Sponsored first</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function BoardCard({ board: b, compareIds, toggleCompare, badgeLeft, score }: { board: Board; compareIds: string[]; toggleCompare: (id: string) => void; badgeLeft?: string; score?: number }) {
  return (
    <Card className={`rounded-2xl overflow-hidden border ${b.sponsored ? 'ring-1 ring-amber-300' : ''}`}>
      <div className="relative">
        <img src={b.img} alt={`${b.model} by ${b.shaper}`} className="h-44 w-full object-cover"/>
        {badgeLeft && (<div className="absolute left-3 top-3"><Badge>{badgeLeft}</Badge></div>)}
      </div>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-neutral-500">{b.shaper}</div>
            <h3 className="text-lg font-semibold">{b.model}</h3>
          </div>
          <div className="flex items-center gap-2">
            {typeof score === 'number' && <Badge variant="outline">Score {score}</Badge>}
            {b.sponsored && (
              <Badge variant="secondary" className="shrink-0 flex items-center gap-1"><Star className="h-3 w-3"/> Sponsored</Badge>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Spec label="Length" value={b.length} icon={Ruler} />
          <Spec label="Volume" value={`${b.volume} L`} icon={Layers} />
          <Spec label="Tail" value={b.tail} icon={Columns2} />
          <Spec label="Fins" value={b.fins} icon={PlusSquare} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap gap-2">{b.waveTypes.map(w=> <Badge key={w} variant="outline">{WAVE_TYPES.find(x=>x.value===w)?.label}</Badge>)}</div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-black" checked={compareIds.includes(b.id)} onChange={()=>toggleCompare(b.id)} />Compare</label>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="w-full">View Details</Button>
          <Button className="w-full">Buy / Where to Get</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparePreview({ compareIds, boards, onRemove }: { compareIds: string[]; boards: Board[]; onRemove: (id: string) => void }){
  const selected = boards.filter(b=> compareIds.includes(b.id));
  return (
    <div className="flex-1 flex items-center gap-2 overflow-x-auto">
      {selected.map(b=> (
        <div key={b.id} className="flex items-center gap-2 bg-neutral-50 border rounded-xl px-3 py-2">
          <img src={b.img} alt={b.model} className="h-10 w-16 object-cover rounded" />
          <div className="text-sm"><div className="font-medium leading-tight">{b.model}</div><div className="text-neutral-500 leading-tight">{b.shaper}</div></div>
          <button className="ml-2" onClick={()=>onRemove(b.id)}><X className="h-4 w-4"/></button>
        </div>
      ))}
    </div>
  );
}

function CompareTable({ boards }: { boards: (Board & { _score?: number })[] }){
  if(!boards.length) return <div className="text-sm text-neutral-600">No boards selected yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500"><th className="p-3">Spec</th>{boards.map(b=> <th key={b.id} className="p-3">{b.shaper} – {b.model}</th>)}</tr>
        </thead>
        <tbody>
          {[
            { k: "length", label: "Length" },
            { k: "volume", label: "Volume (L)" },
            { k: "tail", label: "Tail" },
            { k: "fins", label: "Fin Setup" },
            { k: "construction", label: "Construction" },
          ].map(row=> (
            <tr key={row.k} className="border-t"><td className="p-3 font-medium">{row.label}</td>{boards.map(b=> <td key={b.id+row.k} className="p-3">{String((b as any)[row.k])}</td>)}</tr>
          ))}
          <tr className="border-t"><td className="p-3 font-medium">Match score</td>{boards.map(b=> <td key={b.id+"score"} className="p-3">{Math.round((b as any)._score||0)}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

function SkeletonGrid(){
  return <div className="grid sm:grid-cols-2 gap-6">{Array.from({length:4}).map((_,i)=> <div key={i} className="h-72 bg-neutral-50 border rounded-2xl animate-pulse"/> )}</div>;
}
function EmptyState(){ return <div className="border rounded-2xl p-8 text-center text-neutral-600">No matches yet. Try adjusting weight, wave type, ability, or clear shaper filters.</div>; }
function TopBannerAd(){ return <div className="w-full bg-neutral-100 border rounded-2xl p-4 flex items-center justify-center text-neutral-500"><span className="uppercase tracking-widest text-xs">Advertisement</span></div>; }
function SidebarAd(){ return (
  <div className="sticky top-6 space-y-4">
    <div className="h-64 bg-neutral-100 border rounded-2xl p-4 flex items-center justify-center text-neutral-500"><span className="uppercase tracking-widest text-xs">Ad 300×600</span></div>
    <div className="h-64 bg-neutral-100 border rounded-2xl p-4 flex items-center justify-center text-neutral-500"><span className="uppercase tracking-widest text-xs">Ad 300×600</span></div>
  </div>
); }
function InFeedAd(){ return <div className="h-40 bg-neutral-100 border rounded-2xl p-4 flex items-center justify-center text-neutral-500"><span className="uppercase tracking-widest text-xs">Sponsored</span></div>; }
function Spec({label, value, icon:Icon}:{label:string; value:string|number; icon:any}){ return (
  <div className="flex items-center gap-2 text-neutral-700"><Icon className="h-4 w-4"/><span className="font-medium">{label}:</span><span>{value}</span></div>
);}
