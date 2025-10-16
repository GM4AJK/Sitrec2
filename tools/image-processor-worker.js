// Image processing web worker
self.onmessage = async (event) => {
    const { url, id } = event.data;

    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);

        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);

        // Send back minimal data to avoid transfer overhead
        self.postMessage({
            id,
            success: true,
            width: bitmap.width,
            height: bitmap.height,
            url
        });

        bitmap.close();
    } catch (err) {
        self.postMessage({
            id,
            success: false,
            error: err.message,
            url
        });
    }
};