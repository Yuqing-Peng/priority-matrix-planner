(function () {
    const ENDPOINTS = {
        tasks: '/api/tasks',
        completedTasks: '/api/completed-tasks',
        settings: '/api/settings',
        timers: '/api/timers'
    };

    const serverState = window.__PLANNER_STATE__;
    const online = !!serverState;
    let queue = Promise.resolve();

    function send(method, key, body) {
        const url = ENDPOINTS[key];
        if (!online || !url) return;
        queue = queue
            .then(() => fetch(url, {
                method,
                headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
                body,
                keepalive: !body || body.length < 60000
            }))
            .then(res => {
                if (!res.ok) {
                    return res.text().then(t => console.error(`Sync ${method} ${url} failed (${res.status}): ${t}`));
                }
            })
            .catch(err => console.error(`Sync ${method} ${url} failed:`, err));
    }

    function setItem(key, value) {
        localStorage.setItem(key, value);
        send('PUT', key, value);
    }

    function removeItem(key) {
        localStorage.removeItem(key);
        send('DELETE', key);
    }

    function isEmpty(value) {
        return value == null
            || (Array.isArray(value) && value.length === 0)
            || (typeof value === 'object' && Object.keys(value).length === 0);
    }

    if (online) {
        const serverHasData = ['tasks', 'completedTasks', 'settings'].some(k => !isEmpty(serverState[k]));

        Object.keys(ENDPOINTS).forEach(key => {
            const local = localStorage.getItem(key);
            if (serverHasData) {
                if (serverState[key] == null) localStorage.removeItem(key);
                else localStorage.setItem(key, JSON.stringify(serverState[key]));
            } else if (local !== null) {
                send('PUT', key, local);
            }
        });
    } else {
        console.info('Planner backend not detected - using browser localStorage only.');
    }

    window.PlannerStore = { online, setItem, removeItem };
})();
