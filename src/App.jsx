import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Plus, ImagePlus, X, Trash2, ChevronRight, Camera, Pencil, Download } from "lucide-react";

// Standalone-app storage: mirrors the {get,set,delete} shape used throughout
// this file, but backed by the browser's own localStorage (works offline,
// no server round trip, no size-limit surprises for this kind of app).
const storage = {
  async get(key) {
    const v = localStorage.getItem(key);
    return v !== null ? { key, value: v } : null;
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { key, deleted: true };
  },
};

// ---------- helpers ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const fmtUpdated = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy}, ${hh}.${mi}`;
};

// resize + compress an image file so storage stays small
function fileToCompressedDataUrl(file, maxDim = 640, quality = 0.55) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Gagal memuat gambar"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const INDEX_KEY = "notes-index";
const noteKey = (id) => `note:${id}`;
const imgKey = (noteId, imageId) => `img:${noteId}:${imageId}`;

// retry a flaky storage call a couple of times before giving up
async function withRetry(fn, attempts = 3, delayMs = 350) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fn();
      if (res) return res;
      lastErr = new Error("respons kosong dari penyimpanan");
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw lastErr;
}

const ROW_COLORS = [
  { label: "Default", value: null },
  { label: "Hijau", value: "#4C8C4A" },
  { label: "Biru", value: "#4C7FBF" },
  { label: "Kuning", value: "#C9A227" },
  { label: "Merah", value: "#C1554A" },
  { label: "Ungu", value: "#8A63C9" },
];

export default function CatatanToko() {
  const [ready, setReady] = useState(false);
  const [index, setIndex] = useState([]); // [{id,title,updatedAt,entryCount}]
  const [view, setView] = useState({ type: "home" }); // home | note | entry
  const [activeNote, setActiveNote] = useState(null); // full note object
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [showNewNote, setShowNewNote] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null); // {message, onConfirm}
  const [newNoteTitle, setNewNoteTitle] = useState("");

  const [entryModal, setEntryModal] = useState(null); // {mode:'new'|'edit', toko,date,jam,id}
  const [preview, setPreview] = useState(null); // {id, dataUrl}

  // auto-dismiss error toasts so they never linger and block buttons underneath
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 4500);
    return () => clearTimeout(t);
  }, [error]);

  // -------- load index on mount --------
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(INDEX_KEY, false);
        setIndex(res ? JSON.parse(res.value) : []);
      } catch {
        setIndex([]);
      }
      setReady(true);
    })();
  }, []);

  const persistIndex = useCallback(async (idx) => {
    setIndex(idx);
    try {
      await withRetry(() => storage.set(INDEX_KEY, JSON.stringify(idx), false));
    } catch (e) {
      setError(`Gagal menyimpan daftar catatan: ${e.message || e}`);
    }
  }, []);

  const persistNote = useCallback(
    async (note) => {
      // never send image bytes to storage — keep photos local-only so metadata saves always succeed
      const lean = { ...note, entries: note.entries.map(({ images, ...rest }) => rest) };
      try {
        await withRetry(() => storage.set(noteKey(note.id), JSON.stringify(lean), false));
        const idx = index.some((n) => n.id === note.id)
          ? index.map((n) =>
              n.id === note.id
                ? { ...n, title: note.title, updatedAt: note.updatedAt, entryCount: note.entries.length }
                : n
            )
          : [...index, { id: note.id, title: note.title, updatedAt: note.updatedAt, entryCount: note.entries.length }];
        await persistIndex(idx.sort((a, b) => b.updatedAt - a.updatedAt));
      } catch (e) {
        setError(`Gagal menyimpan data: ${e.message || e}`);
      }
    },
    [index, persistIndex]
  );

  // -------- navigation / loading --------
  const openNote = async (id) => {
    setBusy(true);
    setError("");
    try {
      const res = await storage.get(noteKey(id), false);
      const raw = res ? JSON.parse(res.value) : { id, title: id, entries: [], updatedAt: Date.now() };
      const note = { ...raw, entries: raw.entries.map((e) => ({ images: [], ...e })) };
      setActiveNote(note);
      setView({ type: "note", noteId: id });
    } catch {
      setError("Gagal membuka catatan.");
    }
    setBusy(false);
  };

  const openEntry = (entryId) => setView({ type: "entry", noteId: activeNote.id, entryId });

  const goHome = () => {
    setActiveNote(null);
    setView({ type: "home" });
  };

  const backToNote = () => setView({ type: "note", noteId: activeNote.id });

  // -------- mutations --------
  const createNote = async () => {
    const title = newNoteTitle.trim();
    if (!title) return;
    const note = { id: uid(), title, entries: [], updatedAt: Date.now() };
    setShowNewNote(false);
    setNewNoteTitle("");
    await persistNote(note);
    setActiveNote(note);
    setView({ type: "note", noteId: note.id });
  };

  const deleteNote = async (id) => {
    const idx = index.filter((n) => n.id !== id);
    await persistIndex(idx);
    try {
      await storage.delete(noteKey(id), false);
    } catch {
      /* ignore */
    }
    if (view.noteId === id) goHome();
  };

  const saveEntry = async () => {
    if (!entryModal) return;
    const toko = entryModal.toko.trim() || "Tanpa nama";
    const date = entryModal.date.trim();
    const jam = entryModal.jam.trim();
    let note = { ...activeNote };
    const color = entryModal.color ?? null;
    if (entryModal.mode === "new") {
      note.entries = [...note.entries, { id: uid(), toko, date, jam, color, images: [] }];
    } else {
      note.entries = note.entries.map((e) => (e.id === entryModal.id ? { ...e, toko, date, jam, color } : e));
    }
    note.updatedAt = Date.now();
    setActiveNote(note);
    setEntryModal(null);
    await persistNote(note);
  };

  const deleteEntry = async (entryId) => {
    let note = { ...activeNote };
    note.entries = note.entries.filter((e) => e.id !== entryId);
    note.updatedAt = Date.now();
    setActiveNote(note);
    await persistNote(note);
    if (view.type === "entry" && view.entryId === entryId) backToNote();
  };

  // adding a photo just updates local state — instant, no server round trip needed
  const addImages = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setBusy(true);
    setError("");
    Promise.all(
      files.map((file) =>
        fileToCompressedDataUrl(file).catch((e) => {
          setError(`Satu foto gagal diproses: ${e.message || e}`);
          return null;
        })
      )
    ).then((dataUrls) => {
      const newImages = dataUrls.filter(Boolean).map((dataUrl) => ({ id: uid(), dataUrl }));
      if (newImages.length) {
        setActiveNote((prev) => {
          const note = { ...prev };
          note.entries = note.entries.map((e) =>
            e.id === view.entryId ? { ...e, images: [...(e.images || []), ...newImages] } : e
          );
          note.updatedAt = Date.now();
          persistNote(note); // fire-and-forget for the text/metadata side
          return note;
        });
      }
      setBusy(false);
    });
  };

  const deleteImage = (entryId, imageId) => {
    setActiveNote((prev) => {
      const note = { ...prev };
      note.entries = note.entries.map((e) =>
        e.id === entryId ? { ...e, images: (e.images || []).filter((img) => img.id !== imageId) } : e
      );
      note.updatedAt = Date.now();
      persistNote(note);
      return note;
    });
    setPreview(null);
  };

  const updateEntryNotes = (entryId, notes) => {
    setActiveNote((prev) => {
      const note = { ...prev };
      note.entries = note.entries.map((e) => (e.id === entryId ? { ...e, notes } : e));
      note.updatedAt = Date.now();
      persistNote(note);
      return note;
    });
  };

  // ---------- render ----------
  if (!ready) {
    return (
      <div style={S.appShell}>
        <div style={S.loadingText}>Memuat…</div>
      </div>
    );
  }

  return (
    <div style={S.appShell}>
      <style>{FONT_IMPORT}</style>
      {error && (
        <div style={S.errorBar} onClick={() => setError("")}>
          {error} <span style={{ opacity: 0.7 }}>(ketuk untuk tutup)</span>
        </div>
      )}

      {view.type === "home" && (
        <HomeView
          index={index}
          onOpen={openNote}
          onDelete={(id, title) =>
            setConfirmDialog({
              message: `Hapus "${title}"? Semua isi & foto ikut terhapus.`,
              onConfirm: () => deleteNote(id),
            })
          }
          onNew={() => setShowNewNote(true)}
        />
      )}

      {view.type === "note" && activeNote && (
        <NoteView
          note={activeNote}
          busy={busy}
          onBack={goHome}
          onOpenEntry={openEntry}
          onNewEntry={() => setEntryModal({ mode: "new", toko: "", date: "", jam: "", color: null })}
          onEditEntry={(e) =>
            setEntryModal({ mode: "edit", id: e.id, toko: e.toko, date: e.date, jam: e.jam, color: e.color ?? null })
          }
          onDeleteEntry={(entry) =>
            setConfirmDialog({
              message: `Hapus baris "${entry.toko}"?`,
              onConfirm: () => deleteEntry(entry.id),
            })
          }
        />
      )}

      {view.type === "entry" &&
        activeNote &&
        (() => {
          const entry = activeNote.entries.find((e) => e.id === view.entryId);
          if (!entry) return null;
          return (
            <EntryView
              entry={entry}
              images={entry.images || []}
              busy={busy}
              onBack={backToNote}
              onEdit={() =>
                setEntryModal({ mode: "edit", id: entry.id, toko: entry.toko, date: entry.date, jam: entry.jam, color: entry.color ?? null })
              }
              onFiles={addImages}
              onPreview={(img) => setPreview(img)}
              onSaveNotes={(notes) => updateEntryNotes(entry.id, notes)}
            />
          );
        })()}

      {showNewNote && (
        <Modal onClose={() => setShowNewNote(false)}>
          <div style={S.modalTitle}>Catatan baru</div>
          <input
            autoFocus
            style={S.modalInput}
            placeholder="mis. bostriyo@gmail.com"
            value={newNoteTitle}
            onChange={(e) => setNewNoteTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createNote()}
          />
          <div style={S.modalActions}>
            <button style={S.btnGhost} onClick={() => setShowNewNote(false)}>Batal</button>
            <button style={S.btnPrimary} onClick={createNote}>Buat</button>
          </div>
        </Modal>
      )}

      {entryModal && (
        <Modal onClose={() => setEntryModal(null)}>
          <div style={S.modalTitle}>{entryModal.mode === "new" ? "Tambah baris" : "Edit baris"}</div>
          <label style={S.fieldLabel}>Toko</label>
          <input
            autoFocus
            style={S.modalInput}
            placeholder="Nama toko"
            value={entryModal.toko}
            onChange={(e) => setEntryModal({ ...entryModal, toko: e.target.value })}
          />
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={S.fieldLabel}>Date</label>
              <input
                style={S.modalInput}
                placeholder=""
                value={entryModal.date}
                onChange={(e) => setEntryModal({ ...entryModal, date: e.target.value })}
              />
            </div>
            <div style={{ width: 90 }}>
              <label style={S.fieldLabel}>Jam</label>
              <input
                style={S.modalInput}
                placeholder=""
                value={entryModal.jam}
                onChange={(e) => setEntryModal({ ...entryModal, jam: e.target.value })}
              />
            </div>
          </div>
          <label style={S.fieldLabel}>Warna baris</label>
          <div style={S.swatchRow}>
            {ROW_COLORS.map((c) => (
              <button
                key={c.label}
                title={c.label}
                onClick={() => setEntryModal({ ...entryModal, color: c.value })}
                style={{
                  ...S.swatch,
                  background: c.value || T.card,
                  border:
                    entryModal.color === c.value ? `2px solid ${T.textPrimary}` : `2px solid ${T.cardBorder}`,
                }}
              >
                {c.value === null && <X size={13} color={T.textSecondary} />}
              </button>
            ))}
          </div>
          <div style={S.modalActions}>
            <button style={S.btnGhost} onClick={() => setEntryModal(null)}>Batal</button>
            <button style={S.btnPrimary} onClick={saveEntry}>Simpan</button>
          </div>
        </Modal>
      )}

      {confirmDialog && (
        <Modal onClose={() => setConfirmDialog(null)}>
          <div style={S.modalTitle}>Konfirmasi</div>
          <div style={{ fontSize: 14, color: T.textPrimary, marginBottom: 18, lineHeight: 1.5 }}>
            {confirmDialog.message}
          </div>
          <div style={S.modalActions}>
            <button style={S.btnGhost} onClick={() => setConfirmDialog(null)}>Batal</button>
            <button
              style={{ ...S.btnPrimary, background: T.danger, color: "#241109" }}
              onClick={() => {
                confirmDialog.onConfirm();
                setConfirmDialog(null);
              }}
            >
              Hapus
            </button>
          </div>
        </Modal>
      )}

      {preview && (
        <div style={S.previewOverlay} onClick={() => setPreview(null)}>
          <img src={preview.dataUrl} alt="" style={S.previewImg} onClick={(e) => e.stopPropagation()} />
          <div style={S.previewActions} onClick={(e) => e.stopPropagation()}>
            <a
              href={preview.dataUrl}
              download={`foto-${preview.id}.jpg`}
              style={S.previewSave}
            >
              <Download size={18} />
              Simpan ke HP
            </a>
            <button
              style={S.previewDelete}
              onClick={(e) => {
                e.stopPropagation();
                deleteImage(view.entryId, preview.id);
              }}
            >
              <Trash2 size={18} />
              Hapus
            </button>
          </div>
          <button style={S.previewClose} onClick={() => setPreview(null)}>
            <X size={22} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- subviews ----------

function HomeView({ index, onOpen, onDelete, onNew }) {
  return (
    <div style={S.screen}>
      <div style={S.topbar}>
        <div style={S.brandRow}>
          <div style={S.brandMark}>柱</div>
          <div>
            <div style={S.brandTitle}>Buku Catatan</div>
            <div style={S.brandSub}>{index.length} akun tersimpan</div>
          </div>
        </div>
      </div>

      <div style={S.list}>
        {index.length === 0 && (
          <div style={S.emptyState}>
            <div style={{ fontSize: 15, marginBottom: 4 }}>Belum ada catatan.</div>
            <div style={{ fontSize: 13, color: T.textSecondary }}>Ketuk + untuk membuat catatan pertama.</div>
          </div>
        )}
        {index.map((n) => (
          <div key={n.id} data-tap style={S.rowCard} onClick={() => onOpen(n.id)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={S.rowTitle}>{n.title}</div>
              <div style={S.rowMeta}>
                {n.entryCount ?? 0} baris · diubah {fmtUpdated(n.updatedAt)}
              </div>
            </div>
            <button
              style={S.iconBtnGhost}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(n.id, n.title);
              }}
            >
              <Trash2 size={16} />
            </button>
            <ChevronRight size={18} color={T.textSecondary} />
          </div>
        ))}
      </div>

      <button style={S.fab} onClick={onNew}>
        <Plus size={26} color={T.bg} />
      </button>
    </div>
  );
}

function NoteView({ note, busy, onBack, onOpenEntry, onNewEntry, onEditEntry, onDeleteEntry }) {
  return (
    <div style={S.screen}>
      <div style={S.topbar}>
        <button style={S.iconBtn} onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.headerTitle}>{note.title}</div>
        </div>
        <button style={S.iconBtnAccent} onClick={onNewEntry}>
          <Plus size={18} color={T.bg} />
        </button>
      </div>

      <div style={S.tableHead}>
        <div style={{ flex: 1.3 }}>TOKO</div>
        <div style={{ flex: 1 }}>DATE</div>
        <div style={{ width: 40, textAlign: "right" }}>JAM</div>
        <div style={{ width: 56 }} />
      </div>

      <div style={S.list}>
        {note.entries.length === 0 && (
          <div style={S.emptyState}>
            <div style={{ fontSize: 15, marginBottom: 4 }}>Belum ada baris.</div>
            <div style={{ fontSize: 13, color: T.textSecondary }}>Ketuk + di atas untuk menambah baris data.</div>
          </div>
        )}
        {note.entries.map((e) => {
          const c = e.color;
          const rowStyle = c
            ? { ...S.entryRow, background: c, borderColor: c }
            : S.entryRow;
          const photoCount = (e.images || []).length;
          const dimText = c ? "rgba(255,255,255,0.85)" : T.textSecondary;
          const iconBtnStyle = c ? { ...S.iconBtnGhostSmall, background: "rgba(0,0,0,0.18)", color: "#fff" } : S.iconBtnGhostSmall;
          return (
          <div key={e.id} data-tap style={rowStyle} onClick={() => onOpenEntry(e.id)}>
            <div style={{ flex: 1.3, minWidth: 0 }}>
              <div style={{ ...S.entryToko, color: c ? "#fff" : T.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.toko}</div>
              {photoCount > 0 && (
                <div style={{ ...S.photoBadge, color: c ? "#fff" : T.accent }}>
                  <Camera size={11} /> {photoCount}
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0, ...S.mono, fontSize: 12.5, color: dimText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.date || "—"}</div>
            <div style={{ width: 40, flexShrink: 0, textAlign: "right", ...S.mono, fontSize: 12.5, color: dimText, whiteSpace: "nowrap" }}>{e.jam || "—"}</div>
            <div style={{ width: 56, display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button
                style={iconBtnStyle}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onEditEntry(e);
                }}
              >
                <Pencil size={13} />
              </button>
              <button
                style={iconBtnStyle}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onDeleteEntry(e);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          );
        })}
      </div>
      {busy && <div style={S.busyBar}>Menyimpan…</div>}
    </div>
  );
}

function EntryView({ entry, images, busy, onBack, onEdit, onFiles, onPreview, onSaveNotes }) {
  const c = entry.color;
  const [notesText, setNotesText] = useState(entry.notes || "");
  useEffect(() => {
    setNotesText(entry.notes || "");
  }, [entry.id]);

  return (
    <div style={S.screen}>
      <div style={{ ...S.topbar, ...(c ? { borderBottom: `1px solid ${c}55` } : {}) }}>
        <button style={S.iconBtn} onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.headerTitle}>
            {c && <span style={{ ...S.colorDot, background: c }} />}
            {entry.toko}
          </div>
          <div style={{ ...S.mono, fontSize: 12, color: T.textSecondary }}>
            {entry.date || "—"} · {entry.jam ? `${entry.jam}.00` : "—"}
          </div>
        </div>
        <button style={S.iconBtn} onClick={onEdit}>
          <Pencil size={17} />
        </button>
      </div>

      <div style={S.entryBody}>
        <div style={S.galleryHead}>
          <span>FOTO ({images.length})</span>
          <PhotoPicker onFiles={onFiles} disabled={busy}>
            <span style={S.addPhotoBtn}>
              <ImagePlus size={15} />
              {busy ? "Mengunggah…" : "Tambah foto"}
            </span>
          </PhotoPicker>
        </div>

        {images.length === 0 ? (
          <PhotoPicker onFiles={onFiles} disabled={busy} style={{ display: "block" }}>
            <div data-tap style={S.photoEmpty}>
              <Camera size={28} color={T.textSecondary} />
              <div style={{ marginTop: 8, fontSize: 13.5, color: T.textSecondary }}>
                Belum ada foto — ketuk untuk unggah
              </div>
            </div>
          </PhotoPicker>
        ) : (
          <div style={S.grid}>
            {images.map((img) => (
              <div key={img.id} data-tap style={S.thumbWrap} onClick={() => onPreview(img)}>
                <img src={img.dataUrl} alt="" style={S.thumb} />
              </div>
            ))}
            <PhotoPicker onFiles={onFiles} disabled={busy}>
              <div data-tap style={S.thumbAdd}>
                <Plus size={22} color={T.accent} />
              </div>
            </PhotoPicker>
          </div>
        )}

        <div style={S.notesHead}>CATATAN</div>
        <textarea
          style={S.notesArea}
          placeholder="Tulis catatan tambahan di sini — detail transaksi, keterangan, atau apa saja…"
          value={notesText}
          onChange={(e) => setNotesText(e.target.value)}
          onBlur={() => {
            if ((entry.notes || "") !== notesText) onSaveNotes(notesText);
          }}
        />
      </div>
    </div>
  );
}

// Wraps a visual trigger in a real <label> around a real (visually hidden) file
// input. This is the reliable cross-browser/webview way to open the native photo
// picker — it doesn't depend on a synthetic ref.click(), which some mobile
// webviews silently block.
function PhotoPicker({ onFiles, disabled, children, style }) {
  return (
    <label style={{ ...style, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1 }}>
      {children}
      <input
        type="file"
        accept="image/*"
        multiple
        disabled={disabled}
        style={S.hiddenFileInput}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function Modal({ children, onClose }) {
  return (
    <div style={S.modalOverlay} onClick={onClose}>
      <div style={S.modalCard} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ---------- design tokens ----------
const T = {
  bg: "#10130F",
  bgScreen: "#141813",
  card: "#1B211B",
  cardBorder: "#293026",
  accent: "#A6C48A",
  accentDark: "#7E9A66",
  danger: "#C4785F",
  textPrimary: "#EDEFE7",
  textSecondary: "#8B9385",
};

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
button, [data-tap] {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
`;

const S = {
  appShell: {
    fontFamily: "'Inter', system-ui, sans-serif",
    background: T.bg,
    color: T.textPrimary,
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
  },
  screen: {
    width: "100%",
    maxWidth: 480,
    minHeight: "100vh",
    background: T.bgScreen,
    display: "flex",
    flexDirection: "column",
    position: "relative",
  },
  loadingText: { padding: 40, color: T.textSecondary, fontSize: 14 },
  mono: { fontFamily: "'JetBrains Mono', monospace" },

  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 14px",
    borderBottom: `1px solid ${T.cardBorder}`,
    position: "sticky",
    top: 0,
    background: T.bgScreen,
    zIndex: 5,
  },
  brandRow: { display: "flex", alignItems: "center", gap: 12 },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 10,
    background: T.accent,
    color: T.bg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Sora', sans-serif",
    fontWeight: 700,
    fontSize: 16,
  },
  brandTitle: { fontFamily: "'Sora', sans-serif", fontWeight: 600, fontSize: 17.5 },
  brandSub: { fontSize: 12.5, color: T.textSecondary, marginTop: 1 },
  headerTitle: {
    fontFamily: "'Sora', sans-serif",
    fontWeight: 600,
    fontSize: 16,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  list: { padding: "10px 12px 100px", display: "flex", flexDirection: "column", gap: 8, flex: 1 },
  emptyState: { padding: "40px 10px", textAlign: "center", color: T.textPrimary },

  rowCard: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: T.card,
    border: `1px solid ${T.cardBorder}`,
    borderRadius: 14,
    padding: "14px 12px",
    cursor: "pointer",
  },
  rowTitle: { fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rowMeta: { fontSize: 12, color: T.textSecondary, marginTop: 3 },

  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    border: "none",
    background: "transparent",
    color: T.textPrimary,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  iconBtnAccent: {
    width: 34,
    height: 34,
    borderRadius: 9,
    border: "none",
    background: T.accent,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  iconBtnGhost: {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: T.textSecondary,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  iconBtnGhostSmall: {
    width: 26,
    height: 26,
    borderRadius: 7,
    border: "none",
    background: "rgba(255,255,255,0.04)",
    color: T.textSecondary,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },

  fab: {
    position: "absolute",
    bottom: 26,
    right: 20,
    width: 54,
    height: 54,
    borderRadius: 27,
    background: T.accent,
    border: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
    cursor: "pointer",
  },

  tableHead: {
    display: "flex",
    padding: "10px 14px 8px",
    fontSize: 11,
    letterSpacing: 0.6,
    color: T.textSecondary,
    fontWeight: 600,
    borderBottom: `1px solid ${T.cardBorder}`,
  },
  entryRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: T.card,
    border: `1px solid ${T.cardBorder}`,
    borderRadius: 12,
    padding: "12px 10px",
    cursor: "pointer",
  },
  entryToko: { fontSize: 14.5, fontWeight: 500 },
  photoBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    color: T.accent,
    marginTop: 4,
  },
  busyBar: {
    position: "absolute",
    bottom: 14,
    left: "50%",
    transform: "translateX(-50%)",
    background: T.accentDark,
    color: T.bg,
    padding: "6px 14px",
    borderRadius: 20,
    fontSize: 12.5,
    fontWeight: 500,
  },

  entryBody: { padding: 16, flex: 1 },
  galleryHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 11.5,
    letterSpacing: 0.6,
    color: T.textSecondary,
    fontWeight: 600,
    marginBottom: 12,
  },
  notesHead: {
    fontSize: 11.5,
    letterSpacing: 0.6,
    color: T.textSecondary,
    fontWeight: 600,
    marginTop: 26,
    marginBottom: 10,
  },
  notesArea: {
    width: "100%",
    minHeight: 140,
    background: T.card,
    border: `1px solid ${T.cardBorder}`,
    borderRadius: 12,
    padding: "12px 14px",
    color: T.textPrimary,
    fontSize: 14.5,
    fontFamily: "'Inter', system-ui, sans-serif",
    lineHeight: 1.55,
    resize: "vertical",
    outline: "none",
    boxSizing: "border-box",
  },
  addPhotoBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: T.accent,
    color: T.bg,
    border: "none",
    borderRadius: 10,
    padding: "7px 12px",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  hiddenFileInput: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0,
  },
  photoEmpty: {
    border: `1.5px dashed ${T.cardBorder}`,
    borderRadius: 14,
    padding: "44px 10px",
    textAlign: "center",
    cursor: "pointer",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 8,
  },
  thumbWrap: {
    position: "relative",
    aspectRatio: "1",
    borderRadius: 10,
    overflow: "hidden",
    border: `1px solid ${T.cardBorder}`,
    cursor: "pointer",
  },
  unsavedBadge: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    background: "rgba(196,120,95,0.9)",
    color: "#fff",
    fontSize: 9,
    textAlign: "center",
    padding: "2px 0",
  },
  thumb: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  thumbAdd: {
    aspectRatio: "1",
    borderRadius: 10,
    border: `1.5px dashed ${T.cardBorder}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 50,
  },
  modalCard: {
    width: "100%",
    maxWidth: 480,
    background: T.card,
    borderTop: `1px solid ${T.cardBorder}`,
    borderRadius: "18px 18px 0 0",
    padding: "20px 18px 24px",
  },
  modalTitle: { fontFamily: "'Sora', sans-serif", fontWeight: 600, fontSize: 16, marginBottom: 14 },
  fieldLabel: { fontSize: 11, color: T.textSecondary, fontWeight: 600, letterSpacing: 0.4 },
  modalInput: {
    width: "100%",
    background: T.bgScreen,
    border: `1px solid ${T.cardBorder}`,
    borderRadius: 10,
    padding: "10px 12px",
    color: T.textPrimary,
    fontSize: 14.5,
    margin: "6px 0 12px",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
  },
  swatchRow: { display: "flex", gap: 10, margin: "8px 0 4px" },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  colorDot: {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: "50%",
    marginRight: 6,
    verticalAlign: "middle",
  },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 },
  btnGhost: {
    background: "transparent",
    border: "none",
    color: T.textSecondary,
    padding: "10px 14px",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
  btnPrimary: {
    background: T.accent,
    border: "none",
    color: T.bg,
    padding: "10px 18px",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },

  errorBar: {
    position: "fixed",
    bottom: 18,
    left: "50%",
    transform: "translateX(-50%)",
    background: T.danger,
    color: "#241109",
    padding: "9px 16px",
    borderRadius: 10,
    fontSize: 12,
    zIndex: 100,
    cursor: "pointer",
    maxWidth: "88%",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
  },

  previewOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.9)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 60,
    padding: 20,
  },
  previewImg: { maxWidth: "100%", maxHeight: "70vh", borderRadius: 8, objectFit: "contain" },
  previewActions: { display: "flex", gap: 10, marginTop: 18 },
  previewSave: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: T.accent,
    color: T.bg,
    border: "none",
    borderRadius: 10,
    padding: "10px 18px",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "none",
  },
  previewDelete: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: T.danger,
    color: "#241109",
    border: "none",
    borderRadius: 10,
    padding: "10px 18px",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  previewClose: {
    position: "absolute",
    top: 18,
    right: 18,
    background: "rgba(255,255,255,0.1)",
    border: "none",
    borderRadius: 20,
    width: 38,
    height: 38,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
};
