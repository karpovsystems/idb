// -------------------------
// Helpers
// -------------------------


// Converts argument to array

function toArray (items) {
    if (!items) return [];
    if (Array.isArray(items)) return items;
    return [items];
}


// Triggers onerror listener, returns the error that occurred or the result of onerror handler if it exists

function error (self, error) {
    const altered = self.onerror && self.onerror(error);
    return altered === undefined ? error : altered;
}


// Executes upgrade function by opening a new version of the database

function upgrade (self, upgrade) {
    return self.open(self.db.version + 1, db => {
        upgrade(db);
    });
}


// Executes transaction

function transact (self, options, exec) {
    return new Promise((resolve, reject) => {

        const transaction = self.db.transaction(options.name, options.mode);
        const store = transaction.objectStore(options.name);

        transaction.oncomplete = () => {
            resolve(options.result);
        };

        transaction.onerror = event => {
            reject(error(self, event.target.error));
        };

        exec(store);

    })

}



// --------------------
// DB class
// --------------------

class DB {

    constructor (name) {
        this.name = name;
        this.db = null;
    }


    // Opens indexedDB database

    open (version, upgrade) {
        return new Promise((resolve, reject) => {

            if (this.db) this.db.close();
            const request = indexedDB.open(this.name, version);

            request.onupgradeneeded = () => {
                upgrade && upgrade(request.result);
            }

            request.onerror = () => {
                reject(error(this, request.error));
            }

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this);
            }

        })
    }


    // Lists database stores

    get stores () {
        return Array.from(this.db.objectStoreNames);
    }


    // Checks if the store exists

    hasStore (name) {
        return this.db.objectStoreNames.contains(name)
    }


    // Creates a new store

    async addStore (name, options = {keyPath: 'id'}) {
        return new Promise(async resolve => {
            if (this.hasStore(name)) return resolve();
            await upgrade(this, db => db.createObjectStore(name, options))
            resolve();
        })
    }


    // Deletes the store

    async deleteStore (name) {
        if (!this.hasStore(name)) return;
        return upgrade(this, db => db.deleteObjectStore(name));
    }


    // Adds records to the store

    async add (name, records) {

        await this.addStore(name);

        const options = {
            name,
            mode: 'readwrite',
            result: records
        }

        return transact(this, options, store => {
            toArray(records).forEach(record => store.add(record));
        })
    }


    // Deletes items from the store

    async delete (name, ids) {

        if (!this.hasStore(name)) {
            return Promise.reject(error(this, new Error(`Store "${name}" was not found`)))
        }

        if (ids === undefined) {
            await this.deleteStore(name);
            return Promise.resolve();
        }

        const options = {
            name,
            mode: 'readwrite',
            result: ids
        }

        return transact(this, options, store => {
            toArray(ids).forEach(id => store.delete(id));
        })

    }


    // Updates items in a store

    async put (name, records) {

        if (!this.hasStore(name)) {
            return Promise.reject(error(this, new Error(`Store "${name}" was not found`)))
        }

        const options = {
            name,
            mode: 'readwrite',
            result: records
        }

        return transact(this, options, store => {
            toArray(records).forEach(record => store.put(record));
        })

    }


    // Gets items from the store

    async get (name, ids) {

        if (!this.hasStore(name)) {
            return Promise.reject(error(this, new Error(`Store "${name}" was not found`)))
        }

        let options = {
            name,
            mode: 'readonly',
            result: null
        }

        return transact(this, options, store => {

            let request;

            if (!ids) {
                request = store.getAll();
                request.onsuccess = function() {
                    options.result = request.result;
                };
            }

            else if (!Array.isArray(ids)) {
                request = store.get(ids);
                request.onsuccess = function() {
                    options.result = request.result;
                };
            }

            else {

                const sorted = [...ids].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
                const min = Math.min(...sorted);
                const max = Math.max(...sorted);

                options.result = [];
                request = store.openCursor(IDBKeyRange.bound(min, max));

                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) return;
                    options.result[ids.indexOf(cursor.key)] = cursor.value;
                    const next = sorted[sorted.indexOf(cursor.key) + 1];
                    if (next > -1) cursor.continue(next);
                }

            }

        })
    }

}



// --------------------
// Exports
// --------------------

export default function (name) {
    return new DB(name).open();
}
