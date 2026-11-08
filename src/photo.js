/** Réduit une photo (JPEG, côté le plus long à `size` px) avant l'envoi : quelques centaines de Ko au lieu de plusieurs Mo. */
export async function shrinkPhoto(file, size = 1280) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url })
    for (let q = 0.8; ; q -= 0.15, size = Math.round(size * 0.8)) {
      const k = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight))
      const cv = document.createElement('canvas')
      cv.width = Math.round(img.naturalWidth * k)
      cv.height = Math.round(img.naturalHeight * k)
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
      const data = cv.toDataURL('image/jpeg', q)
      if (data.length < 1_300_000 || q < 0.4) return data
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
