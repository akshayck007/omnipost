// Shared temporary video storage for users without Firebase Storage
// This is a workaround for the Spark plan's storage limitations
export const tempVideoMap = new Map<string, { buffer: Buffer, contentType: string, timestamp: number }>();

// Clean up old videos every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [id, data] of tempVideoMap.entries()) {
      if (now - data.timestamp > 10 * 60 * 1000) { // 10 minutes
        tempVideoMap.delete(id);
        console.log(`Cleaned up temporary video: ${id}`);
      }
    }
  }, 5 * 60 * 1000);
}
