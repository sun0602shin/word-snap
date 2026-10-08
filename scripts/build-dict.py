# Builds public/dict/* from open-english-korean-dict (CC-BY-SA 4.0) + kengdic (MPL 2.0 / LGPL).
# usage: python3 scripts/build-dict.py words.json kengdic.tsv
import json,re,os,sys,collections,shutil,csv
words,ktsv=sys.argv[1],sys.argv[2]
out='public/dict'; shutil.rmtree(out,ignore_errors=True); os.makedirs(out)
EN=collections.defaultdict(list)   # en -> [ko]
KO=collections.defaultdict(list)   # ko -> [en]
def add(en,ko):
  if ko not in EN[en]: EN[en].append(ko)
  if en not in KO[ko]: KO[ko].append(en)
d=json.load(open(words))
for w,v in sorted(d.items(),key=lambda x:x[1].get('freq_rank') or 99999):
  if not re.fullmatch(r"[a-z][a-z'-]*",w): continue
  for t in re.split(r'[,;/]',v.get('meaning_ko') or ''):
    t=t.strip()
    if re.search('[가-힣]',t): add(w,t)
known=set(EN)
for r in csv.reader(open(ktsv),delimiter='\t'):
  if len(r)<4 or r[0]=='id': continue
  ko=re.sub(r'\s+','',r[1]); 
  if not re.fullmatch(r'[가-힣]{1,8}',ko): continue
  for g in re.split(r'[,;]',r[3].lower()):
    g=re.sub(r'^\s*(to|a|an|the|be)\s+','',g.strip()).strip(' .')
    if re.fullmatch(r"[a-z][a-z'-]+",g) and (g in known or len(g)>3): add(g,ko)
def jkey(k):
  c=ord(k[0])-0xAC00; return f"{min(len(k),6)}-{c//588 if 0<=c<11172 else 'x'}"
E1=collections.defaultdict(dict); K1=collections.defaultdict(dict)
for w,l in EN.items(): E1[min(len(w),20)][w]=l[:10]
for k,l in KO.items(): K1[jkey(k)][k]=l[:8]
for n,m in E1.items(): json.dump(m,open(f'{out}/en-{n}.json','w'),ensure_ascii=False,separators=(',',':'))
for n,m in K1.items(): json.dump(m,open(f'{out}/ko-{n}.json','w'),ensure_ascii=False,separators=(',',':'))
print(len(EN),len(KO))
