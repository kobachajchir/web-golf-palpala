export function withEmployeeOperationTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), 30000);
    operation.then(resolve, reject).finally(() => window.clearTimeout(timeoutId));
  });
}
