// server/routes/categories.js
const express = require("express");
const admin = require("firebase-admin");
const { verifyFirebaseIdToken } = require("../middleware/auth");
const router = express.Router();
router.use(verifyFirebaseIdToken);

const db = () => admin.firestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();

function slugify(s){
  return String(s||"").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
}

router.get("/", async (req,res)=>{
  try{
    const { tenant } = req.query;
    if(!tenant) return res.status(400).json({error:"Missing tenant"});
    const snap = await db().collection("companies").doc(tenant).collection("categories")
      .orderBy("sort").get();
    res.json(snap.docs.map(d=>({id:d.id,...d.data()})));
  }catch(e){
    console.error("categories:list",e); res.status(500).json({error:"internal_error"});
  }
});

router.post("/", async (req,res)=>{
  try{
    const { tenant, name, parentId=null, sort=0 } = req.body||{};
    if(!tenant||!name) return res.status(400).json({error:"Missing tenant/name"});
    const slug = slugify(name);
    // path
    let path = [slug];
    if (parentId){
      const p = await db().collection("companies").doc(tenant).collection("categories").doc(parentId).get();
      if(!p.exists) return res.status(400).json({error:"parent_not_found"});
      path = [...(p.data().path||[]), slug];
    }
    const ref = db().collection("companies").doc(tenant).collection("categories").doc();
    await ref.set({ name, slug, parentId, path, sort, productCount: 0, createdAt: now(), updatedAt: now() });
    const fresh = await ref.get();
    res.json({ id: ref.id, ...fresh.data() });
  }catch(e){
    console.error("categories:create",e); res.status(500).json({error:e.message||"internal_error"});
  }
});

router.put("/:id", async (req,res)=>{
  try{
    const { tenant, name, parentId, sort } = req.body||{};
    const { id } = req.params;
    if(!tenant||!id) return res.status(400).json({error:"Missing tenant/id"});
    const toSet = { updatedAt: now() };
    if (name!=null){ toSet.name = String(name); toSet.slug = slugify(name); }
    if (parentId!==undefined) toSet.parentId = parentId || null;
    if (sort!=null) toSet.sort = Number(sort);
    // recomputar path si cambió name o parentId
    if (toSet.name!=null || parentId!==undefined){
      let path = [slugify(toSet.name || name)];
      if (parentId){
        const p = await db().collection("companies").doc(tenant).collection("categories").doc(parentId).get();
        if(!p.exists) return res.status(400).json({error:"parent_not_found"});
        path = [...(p.data().path||[]), path[0]];
      }
      toSet.path = path;
    }
    await db().collection("companies").doc(tenant).collection("categories").doc(id).set(toSet, {merge:true});
    const fresh = await db().collection("companies").doc(tenant).collection("categories").doc(id).get();
    res.json({ id, ...fresh.data() });
  }catch(e){
    console.error("categories:update",e); res.status(500).json({error:e.message||"internal_error"});
  }
});

router.delete("/:id", async (req,res)=>{
  try{
    const { tenant } = req.body||{};
    const { id } = req.params;
    if(!tenant||!id) return res.status(400).json({error:"Missing tenant/id"});
    // opcional: verificar que no tenga subcategorías ni productos
    await db().collection("companies").doc(tenant).collection("categories").doc(id).delete();
    res.json({ ok:true });
  }catch(e){
    console.error("categories:delete",e); res.status(500).json({error:"internal_error"});
  }
});

module.exports = router;
