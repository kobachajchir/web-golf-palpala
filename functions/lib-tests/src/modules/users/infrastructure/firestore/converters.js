export function createAdminConverter() {
    return {
        toFirestore(modelObject) {
            return modelObject;
        },
        fromFirestore(snapshot) {
            return snapshot.data();
        },
    };
}
//# sourceMappingURL=converters.js.map