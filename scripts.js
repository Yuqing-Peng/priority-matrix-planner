let timers = {};

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    loadTasksFromStorage();
    restoreTimersFromStorage();

    document.getElementById('signupBtn')?.addEventListener('click', function () {
        window.location.href = 'index.html';
    });

    document.getElementById('taskForm').addEventListener('submit', function (event) {
        event.preventDefault();
        addTask();
    });

    document.getElementById('taskModal').addEventListener('click', function (event) {
        if (event.target.classList.contains('modal')) {
            closeTaskModal();
        }
    });

    document.querySelectorAll('.matrix-cell, .filter-sort, .add-task-btn').forEach(element => {
        element.classList.add('fade-in');
    });

    document.querySelector('.openbtn').addEventListener('click', () => {
        const sidebar = document.getElementById('mySidebar');
        sidebar.classList.toggle('slide-in');
    });

    document.getElementById('completed-task-list').addEventListener('click', function (event) {
        const taskElement = event.target.closest('.completed-task-item');
        if (taskElement) {
            const taskInfo = taskElement.getAttribute('data-info');
            openTaskInfoModal(taskInfo);
        }
    });

    document.getElementById('clearCompletedTasksBtn')?.addEventListener('click', clearCompletedTasks);

    updateProgressBar();
});

function updateProgressBar() {
    const progressBar = document.getElementById('progress-bar');
    if (!progressBar) return;
    const tasks = document.querySelectorAll('.task');
    const completedTasks = document.querySelectorAll('.task.completed');
    const progress = tasks.length ? (completedTasks.length / tasks.length) * 100 : 0;
    progressBar.style.width = progress + '%';
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

function loadSettings() {
    const defaultSettings = {
        sidebarColor: '#F07167',
        headerColor: '#F07167',
        backgroundColor: '#FDFCDC',
        doColor: '#FF8C89',
        decideColor: '#FFEDCD',
        delegateColor: '#33D1CC',
        deleteColor: '#3399CC'
    };

    const settings = JSON.parse(localStorage.getItem('settings')) || defaultSettings;

    document.querySelector('.sidebar').style.backgroundColor = settings.sidebarColor;
    document.querySelector('.header-container').style.backgroundColor = settings.headerColor;
    document.body.style.backgroundColor = settings.backgroundColor;
    document.querySelector('.primary-color').style.backgroundColor = settings.doColor;
    document.querySelector('.secondary-color').style.backgroundColor = settings.decideColor;
    document.querySelector('.accent-color').style.backgroundColor = settings.delegateColor;
    document.querySelector('.text-color').style.backgroundColor = settings.deleteColor;
}

function toggleNav() {
    const sidebar = document.getElementById("mySidebar");
    const main = document.getElementById("main");

    if (sidebar.style.width === "250px") {
        sidebar.style.width = "0";
        main.style.marginLeft = "0";
    } else {
        sidebar.style.width = "250px";
        main.style.marginLeft = "250px";
    }
}

function openTaskModal() {
    const taskModal = document.getElementById('taskModal');
    taskModal.style.display = 'block';
    taskModal.classList.add('fade-in');
}

function closeTaskModal() {
    document.getElementById('taskModal').style.display = 'none';
}

function openTaskInfoModal(taskInfo) {
    const taskInfoModal = document.getElementById('taskInfoModal');
    const taskInfoElement = document.getElementById('taskInfo');
    taskInfoElement.innerHTML = taskInfo.split('\n').map(info => info.trim()).filter(Boolean)
        .map(info => `<p>${escapeHTML(info)}</p>`).join('');
    taskInfoModal.style.display = 'block';
    taskInfoModal.classList.add('fade-in');
}

function closeTaskInfoModal() {
    document.getElementById('taskInfoModal').style.display = 'none';
}

function toggleCompletedTasks() {
    const completedTaskList = document.getElementById('completed-task-list');
    completedTaskList.classList.toggle('expanded');
}

function loadTasksFromStorage() {
    const tasks = JSON.parse(localStorage.getItem('tasks')) || [];
    const completedTasks = JSON.parse(localStorage.getItem('completedTasks')) || [];

    tasks.forEach(task => addTaskToDOM(task));
    completedTasks.forEach(task => addTaskToDOM(task, true));
}

function saveTasksToStorage() {
    const tasks = Array.from(document.querySelectorAll('.matrix-cell .task:not(.is-leaving)')).map(taskFromElement);

    const completedTasks = Array.from(document.querySelectorAll('.completed-task-item'))
        .map(el => ({ ...taskFromElement(el), status: 'completed', completed: true }));

    PlannerStore.setItem('tasks', JSON.stringify(tasks));
    PlannerStore.setItem('completedTasks', JSON.stringify(completedTasks));
}

function saveTimersToStorage() {
    const serializable = {};
    Object.keys(timers).forEach(id => {
        const { interval, ...rest } = timers[id];
        serializable[id] = rest;
    });
    PlannerStore.setItem('timers', JSON.stringify(serializable));
}

function restoreTimersFromStorage() {
    const storedTimers = JSON.parse(localStorage.getItem('timers')) || {};

    Object.keys(storedTimers).forEach(taskId => {
        const timerData = storedTimers[taskId];
        const taskElement = document.querySelector(`.matrix-cell .task[data-id="${CSS.escape(taskId)}"]`);
        if (!taskElement) return;

        if (timerData.endTime) {
            const endTime = new Date(timerData.endTime).getTime();
            timers[taskId] = {
                remainingTime: timerData.remainingTime,
                endTime,
                interval: setInterval(() => {
                    updateCountdownDisplay(taskElement, endTime, taskId);
                }, 1000)
            };
            setTimerState(taskElement, 'running');
        } else if (typeof timerData.remainingTime === 'number') {
            timers[taskId] = { remainingTime: timerData.remainingTime };
            taskElement.querySelector('.timer-display').textContent = formatTime(timerData.remainingTime);
            setTimerState(taskElement, 'paused');
        }
    });
}

function addTask() {
    const taskName = document.getElementById('taskName').value.trim();
    const taskTime = document.getElementById('taskTime').value.trim();
    const taskUrgency = document.getElementById('taskUrgency').value;
    const taskImportance = document.getElementById('taskImportance').value;
    const taskCategory = document.getElementById('taskCategory').value;
    const taskDeadline = document.getElementById('taskDeadline').value;

    if (!taskName || !taskTime || !taskUrgency || !taskImportance || !taskCategory) {
        return;
    }

    const taskTimeInSeconds = parseInt(taskTime) * 60;

    if (editingTaskId) {
        updateTask(editingTaskId, {
            name: taskName,
            time: taskTimeInSeconds,
            urgency: taskUrgency,
            importance: taskImportance,
            category: taskCategory,
            deadline: taskDeadline
        });
        editingTaskId = null;
        closeTaskModal();
        document.getElementById('taskForm').reset();
        return;
    }

    const taskId = 'task' + new Date().getTime();

    const task = {
        id: taskId,
        name: taskName,
        time: taskTimeInSeconds,
        urgency: taskUrgency,
        importance: taskImportance,
        category: taskCategory,
        deadline: taskDeadline,
        status: 'notStarted'
    };

    addTaskToDOM(task);
    saveTaskToStorage(task);

    closeTaskModal();
    document.getElementById('taskForm').reset();
}

function saveTaskToStorage(task) {
    const tasks = JSON.parse(localStorage.getItem('tasks')) || [];
    tasks.push(task);
    PlannerStore.setItem('tasks', JSON.stringify(tasks));
}

function quadrantListId(urgency, importance) {
    const entry = Object.entries(QUADRANTS)
        .find(([, q]) => q.urgency === urgency && q.importance === importance);
    return entry ? entry[0] : 'delete-list';
}

function cleanDeadline(value) {
    return value && value !== 'undefined' && value !== 'null' ? value : '';
}

function taskFromElement(el) {
    return {
        id: el.dataset.id,
        name: el.querySelector('.task-name').textContent,
        time: parseInt(el.dataset.expectedTime) || 0,
        urgency: el.dataset.urgency,
        importance: el.dataset.importance,
        category: el.dataset.category,
        deadline: cleanDeadline(el.dataset.deadline),
        status: el.dataset.status || 'notStarted'
    };
}

function completedInfo(task) {
    return [
        `Name: ${task.name}`,
        `Time: ${task.time / 60} minutes`,
        `Urgency: ${task.urgency}`,
        `Importance: ${task.importance}`,
        `Category: ${task.category}`,
        `Deadline: ${cleanDeadline(task.deadline) || 'N/A'}`
    ].join('\n');
}

function addTaskToDOM(task, isCompleted = false) {
    const taskElement = document.createElement('li');
    taskElement.classList.add('task', 'fade-in');
    if (isCompleted) taskElement.classList.add('completed-task-item');

    taskElement.setAttribute('data-id', task.id);
    taskElement.setAttribute('data-expected-time', task.time);
    taskElement.setAttribute('data-urgency', task.urgency);
    taskElement.setAttribute('data-importance', task.importance);
    taskElement.setAttribute('data-category', task.category);
    taskElement.setAttribute('data-status', isCompleted ? 'completed' : (task.status || 'notStarted'));
    taskElement.setAttribute('data-deadline', cleanDeadline(task.deadline));

    if (isCompleted) {
        taskElement.innerHTML = `
            <div class="task-body">
                <span class="check-icon" aria-hidden="true"></span>
                <span class="task-name">${escapeHTML(task.name)}</span>
            </div>`;
        taskElement.setAttribute('data-info', completedInfo(task));
        document.getElementById('completed-task-list').appendChild(taskElement);
        return taskElement;
    }

    taskElement.setAttribute('draggable', 'true');
    taskElement.ondragstart = drag;
    taskElement.innerHTML = `
        <div class="swipe-bg swipe-finish" aria-hidden="true">&#10003; Done</div>
        <div class="swipe-bg swipe-delete" aria-hidden="true">Delete &#10005;</div>
        <div class="task-body">
            <button type="button" class="check-btn" title="Mark as done" aria-label="Mark as done"></button>
            <span class="task-name" title="Click to edit">${escapeHTML(task.name)}</span>
            <span class="task-actions">
                <button type="button" class="icon-btn edit-btn" title="Edit" aria-label="Edit task">&#9998;</button>
                <button type="button" class="icon-btn delete-btn" title="Delete" aria-label="Delete task">&#10005;</button>
            </span>
            <button type="button" class="timer-btn" title="Start timer" aria-label="Start timer">
                <span class="timer-display">${formatTime(task.time)}</span>
            </button>
        </div>`;

    taskElement.querySelector('.check-btn').addEventListener('click', () => finishTask(taskElement));
    taskElement.querySelector('.task-name').addEventListener('click', () => editTask(taskElement));
    taskElement.querySelector('.edit-btn').addEventListener('click', () => editTask(taskElement));
    taskElement.querySelector('.delete-btn').addEventListener('click', () => deleteTask(taskElement));
    taskElement.querySelector('.timer-btn').addEventListener('click', () => toggleTimer(taskElement));
    enableSwipe(taskElement);

    document.getElementById(quadrantListId(task.urgency, task.importance)).appendChild(taskElement);
    return taskElement;
}

function enableSwipe(taskElement) {
    const body = taskElement.querySelector('.task-body');
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let mode = null;
    let lastSwipeAt = 0;

    const threshold = () => Math.min(110, body.offsetWidth * 0.35);

    const reset = () => {
        body.style.transform = '';
        taskElement.classList.remove('is-swiping', 'swipe-left', 'swipe-right', 'swipe-armed');
    };

    body.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' || event.target.closest('button')) return;
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        dx = 0;
        mode = null;
    });

    body.addEventListener('pointermove', event => {
        if (event.pointerId !== pointerId) return;
        const moveX = event.clientX - startX;
        const moveY = event.clientY - startY;

        if (!mode) {
            if (Math.abs(moveX) > 10 && Math.abs(moveX) > Math.abs(moveY)) {
                mode = 'swipe';
                try { body.setPointerCapture(pointerId); } catch (e) {  }
                taskElement.classList.add('is-swiping');
            } else if (Math.abs(moveY) > 10) {
                mode = 'scroll';
            }
        }
        if (mode !== 'swipe') return;

        dx = moveX;
        body.style.transform = `translateX(${dx}px)`;
        taskElement.classList.toggle('swipe-left', dx < 0);
        taskElement.classList.toggle('swipe-right', dx > 0);
        taskElement.classList.toggle('swipe-armed', Math.abs(dx) > threshold());
    });

    body.addEventListener('pointerup', event => {
        if (event.pointerId !== pointerId) return;
        pointerId = null;
        if (mode !== 'swipe') return;

        lastSwipeAt = Date.now();
        taskElement.classList.remove('is-swiping');
        if (Math.abs(dx) > threshold()) {
            body.style.transform = `translateX(${dx < 0 ? '-' : ''}110%)`;
            setTimeout(() => (dx < 0 ? deleteTask(taskElement) : finishTask(taskElement)), 180);
        } else {
            reset();
        }
    });

    body.addEventListener('pointercancel', event => {
        if (event.pointerId !== pointerId) return;
        pointerId = null;
        reset();
    });

    body.addEventListener('click', event => {
        if (Date.now() - lastSwipeAt < 400) {
            event.stopPropagation();
            event.preventDefault();
        }
    }, true);
}

function animateOut(taskElement, done) {
    taskElement.classList.add('is-leaving');
    taskElement.style.maxHeight = taskElement.offsetHeight + 'px';
    void taskElement.offsetHeight;
    taskElement.classList.add('is-collapsing');
    setTimeout(() => {
        taskElement.remove();
        done();
    }, 250);
}

function stopTimer(taskId) {
    if (!timers[taskId]) return;
    clearInterval(timers[taskId].interval);
    delete timers[taskId];
    saveTimersToStorage();
}

function setTimerState(taskElement, state) {
    const button = taskElement.querySelector('.timer-btn');
    if (!button) return;
    button.classList.toggle('running', state === 'running');
    button.classList.toggle('paused', state === 'paused');
    const label = state === 'running' ? 'Pause timer' : state === 'paused' ? 'Resume timer' : 'Start timer';
    button.title = label;
    button.setAttribute('aria-label', label);
}

let toastTimeout = null;
function showUndoToast(message, onUndo) {
    let toast = document.getElementById('undoToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'undoToast';
        toast.className = 'toast';
        toast.setAttribute('role', 'status');
        toast.innerHTML = '<span class="toast-message"></span><button type="button" class="toast-undo">Undo</button>';
        document.body.appendChild(toast);
    }

    const hide = () => {
        toast.classList.remove('show');
        clearTimeout(toastTimeout);
    };

    toast.querySelector('.toast-message').textContent = message;
    toast.querySelector('.toast-undo').onclick = () => {
        hide();
        onUndo();
    };
    toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(hide, 5000);
}

function formatTime(seconds) {
    const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const remainingSeconds = String(seconds % 60).padStart(2, '0');
    return `${hours}:${minutes}:${remainingSeconds}`;
}

function toggleTimer(element) {
    const taskElement = element.closest('.task');
    const taskId = taskElement.dataset.id;
    const expected = parseInt(taskElement.dataset.expectedTime) || 0;

    if (!timers[taskId]) {
        timers[taskId] = { remainingTime: expected };
    }
    const timer = timers[taskId];

    if (timer.interval) {
        clearInterval(timer.interval);
        timer.interval = null;
        delete timer.endTime;
        setTimerState(taskElement, 'paused');
        saveTimersToStorage();
        return;
    }

    if (!(timer.remainingTime > 0)) {
        timer.remainingTime = expected;
        taskElement.querySelector('.timer-display').classList.remove('timer-exceeded');
    }
    const endTime = Date.now() + timer.remainingTime * 1000;
    timer.endTime = endTime;
    timer.interval = setInterval(() => {
        updateCountdownDisplay(taskElement, endTime, taskId);
    }, 1000);
    setTimerState(taskElement, 'running');

    taskElement.setAttribute('data-status', 'inProgress');
    saveTasksToStorage();
    saveTimersToStorage();
}

function openEndPopup(title) {
    const popup = window.open('', 'popupWindow', 'width=400,height=200');

    if (popup) {
        popup.document.write(`
            <html>
            <head>
                <title>Task Boost Assistant</title>
                <style>
                    body {
                        background-color: #F07167;
                        color: white;
                        font-family: Arial, sans-serif;
                        text-align: center;
                        padding: 20px;
                        margin: 0;
                    }
                </style>
            </head>
            <body>
                <h2>The task called "${title}" has zero minutes left</h2>
            </body>
            </html>
        `);

        popup.document.close();
    } else {
        alert('Unable to open popup window. Please make sure your browser allows popups.');
    }
}

function updateCountdownDisplay(taskElement, endTime, taskId) {
    const currentTime = new Date().getTime();
    let remainingTime = Math.floor((endTime - currentTime) / 1000);

    if (remainingTime <= 0) {
        clearInterval(timers[taskId].interval);
        taskElement.querySelector('.timer-display').textContent = "00:00:00";
        taskElement.querySelector('.timer-display').classList.add('timer-exceeded');
        setTimerState(taskElement, 'idle');
        timers[taskId].remainingTime = 0;
        timers[taskId].interval = null;
        delete timers[taskId].endTime;
        saveTimersToStorage();
        return;
    }

    timers[taskId].remainingTime = remainingTime;

    const hours = String(Math.floor(remainingTime / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((remainingTime % 3600) / 60)).padStart(2, '0');
    const seconds = String(remainingTime % 60).padStart(2, '0');

    const timerDisplay = taskElement.querySelector('.timer-display');
    timerDisplay.textContent = `${hours}:${minutes}:${seconds}`;

    if (remainingTime === 2) {
        const taskName = taskElement.querySelector('.task-name').textContent;
        openEndPopup(taskName);
    }

    if (remainingTime <= parseInt(taskElement.dataset.expectedTime)) {
        timerDisplay.classList.remove('timer-exceeded');
    } else {
        timerDisplay.classList.add('timer-exceeded');
    }
}

function finishTask(element) {
    const taskElement = element.closest('.task');
    if (!taskElement || taskElement.classList.contains('is-leaving')) return;

    const task = taskFromElement(taskElement);
    stopTimer(task.id);

    taskElement.classList.add('is-finishing');
    setTimeout(() => {
        animateOut(taskElement, () => {
            addTaskToDOM({ ...task, status: 'completed' }, true);
            saveTasksToStorage();
            updateProgressBar();
        });
    }, 250);
}

let editingTaskId = null;

function openNewTaskModal() {
    editingTaskId = null;
    document.getElementById('taskForm').reset();
    document.getElementById('taskModalTitle').textContent = 'Add Task';
    document.getElementById('taskSubmitBtn').textContent = 'Add Task';
    openTaskModal();
}

function editTask(element) {
    const taskElement = element.closest('.task');
    const task = taskFromElement(taskElement);
    editingTaskId = task.id;

    document.getElementById('taskName').value = task.name;
    document.getElementById('taskTime').value = task.time / 60;
    document.getElementById('taskUrgency').value = task.urgency;
    document.getElementById('taskImportance').value = task.importance;
    document.getElementById('taskCategory').value = task.category;
    document.getElementById('taskDeadline').value = task.deadline;
    document.getElementById('taskModalTitle').textContent = 'Edit Task';
    document.getElementById('taskSubmitBtn').textContent = 'Save';

    openTaskModal();
}

function updateTask(taskId, fields) {
    const taskElement = document.querySelector(`.matrix-cell .task[data-id="${CSS.escape(taskId)}"]`);
    if (!taskElement) return;

    taskElement.querySelector('.task-name').textContent = fields.name;
    taskElement.setAttribute('data-expected-time', fields.time);
    taskElement.setAttribute('data-urgency', fields.urgency);
    taskElement.setAttribute('data-importance', fields.importance);
    taskElement.setAttribute('data-category', fields.category);
    taskElement.setAttribute('data-deadline', fields.deadline || '');

    if (!timers[taskId]) {
        taskElement.querySelector('.timer-display').textContent = formatTime(fields.time);
    }

    const list = document.getElementById(quadrantListId(fields.urgency, fields.importance));
    if (taskElement.parentElement !== list) list.appendChild(taskElement);

    saveTasksToStorage();
}

function deleteTask(element) {
    const taskElement = element.closest('.task');
    if (!taskElement || taskElement.classList.contains('is-leaving')) return;

    const task = taskFromElement(taskElement);
    const list = taskElement.parentElement;
    const nextSibling = taskElement.nextElementSibling;
    const timerSnapshot = timers[task.id] ? timers[task.id].remainingTime : null;

    stopTimer(task.id);
    animateOut(taskElement, saveTasksToStorage);

    showUndoToast(`Deleted "${task.name}"`, () => {
        const restored = addTaskToDOM(task);
        if (nextSibling && nextSibling.parentElement === list && restored.parentElement === list) {
            list.insertBefore(restored, nextSibling);
        }
        if (typeof timerSnapshot === 'number') {
            timers[task.id] = { remainingTime: timerSnapshot };
            restored.querySelector('.timer-display').textContent = formatTime(timerSnapshot);
            setTimerState(restored, 'paused');
            saveTimersToStorage();
        }
        saveTasksToStorage();
    });
}

function clearCompletedTasks() {
    const completedTaskList = document.getElementById('completed-task-list');
    completedTaskList.innerHTML = '';

    PlannerStore.removeItem('completedTasks');
}

function allowDrop(event) {
    event.preventDefault();
}

function drag(event) {
    event.dataTransfer.setData("text/plain", event.currentTarget.dataset.id);
}

const QUADRANTS = {
    'do-list': { urgency: 'urgent', importance: 'important' },
    'decide-list': { urgency: 'not-urgent', importance: 'important' },
    'delegate-list': { urgency: 'urgent', importance: 'not-important' },
    'delete-list': { urgency: 'not-urgent', importance: 'not-important' }
};

function drop(event) {
    event.preventDefault();

    const taskId = event.dataTransfer.getData("text/plain");
    const draggedElement = document.querySelector(`.task[data-id="${CSS.escape(taskId)}"]`);
    if (!draggedElement || draggedElement.classList.contains('completed-task-item')) return;

    const dropTarget = event.target.closest('.matrix-cell')?.querySelector('ul.task-list');
    const quadrant = dropTarget && QUADRANTS[dropTarget.id];
    if (quadrant) {
        dropTarget.appendChild(draggedElement);
        draggedElement.setAttribute('data-urgency', quadrant.urgency);
        draggedElement.setAttribute('data-importance', quadrant.importance);
        saveTasksToStorage();
    }
}

function searchTasks() {
    const searchValue = document.getElementById('taskSearch').value.toLowerCase();

    const tasks = document.querySelectorAll('.matrix-cell li');

    tasks.forEach(task => {
        const taskText = task.textContent.toLowerCase();
        task.style.display = taskText.includes(searchValue) ? '' : 'none';
    });
}

function filterTasks() {
    const filterValue = document.getElementById('taskFilter').value;

    const tasks = document.querySelectorAll('.matrix-cell li');

    tasks.forEach(task => {
        if (filterValue === 'all') {
            task.style.display = '';
        } else {
            task.style.display = task.getAttribute('data-category') === filterValue ? '' : 'none';
        }
    });
}

function sortTasks() {
    const sortValue = document.getElementById('taskSort').value;

    const lists = ['do-list', 'decide-list', 'delegate-list', 'delete-list'];

    lists.forEach(listId => {
        const list = document.getElementById(listId);
        Array.from(list.children)
            .sort((a, b) => {
                if (sortValue === 'priority') {
                    return getPriorityValue(b) - getPriorityValue(a);
                } else if (sortValue === 'deadline') {
                    return new Date(a.getAttribute('data-deadline')) - new Date(b.getAttribute('data-deadline'));
                }
            })
            .forEach(node => list.appendChild(node));
    });
}

function getPriorityValue(task) {
    if (task.getAttribute('data-urgency') === 'urgent' && task.getAttribute('data-importance') === 'important') return 3;
    if (task.getAttribute('data-urgency') === 'not-urgent' && task.getAttribute('data-importance') === 'important') return 2;
    if (task.getAttribute('data-urgency') === 'urgent' && task.getAttribute('data-importance') === 'not-important') return 1;
    return 0;
}

const quickQuestions = [
    { question: "Does this task have a strict deadline that must be met?", type: "both" },
    { question: "Will completing this task have a significant impact on achieving your goals?", type: "importance" },
    { question: "Can this task be delegated to someone else without major issues?", type: "urgency" }
];

const longQuestions = [
    { question: "Does this task have a strict deadline that must be met?", type: "both" },
    { question: "Will completing this task have a significant impact on achieving your goals?", type: "importance" },
    { question: "Can this task be delegated to someone else without major issues?", type: "urgency" },
    { question: "Will delaying this task cause negative consequences?", type: "urgency" },
    { question: "Is this task required to meet a commitment made to others?", type: "importance" },
    { question: "Will this task help you avoid future problems or crises?", type: "both" },
    { question: "Is this task directly related to your core responsibilities?", type: "importance" },
    { question: "Will completing this task significantly improve your efficiency or productivity?", type: "importance" },
    { question: "Will this task contribute to long-term success or strategic goals?", type: "importance" },
    { question: "Is this task dependent on the completion of other tasks?", type: "urgency" }
];

let currentQuestions = [];
let currentQuestionIndex = 0;
let importanceScore = 0;
let urgencyScore = 0;

function openTaskModal() {
    document.getElementById('taskModal').style.display = 'block';
}

function closeTaskModal() {
    document.getElementById('taskModal').style.display = 'none';
}

function openAssessmentChoices(type) {
    closeTaskModal();
    document.getElementById('assessmentChoicesModal').style.display = 'block';
    document.getElementById('assessmentChoicesModal').dataset.type = type;
}

function closeAssessmentChoices() {
    document.getElementById('assessmentChoicesModal').style.display = 'none';
    openTaskModal();
}

function openQuickAssessment() {
    currentQuestions = quickQuestions;
    closeAssessmentChoices();
    openModal();
}

function openLongAssessment() {
    currentQuestions = longQuestions;
    closeAssessmentChoices();
    openModal();
}

function openModal() {
    document.getElementById('importanceUrgencyModal').style.display = 'block';
    showQuestion();
}

function closeModal() {
    document.getElementById('importanceUrgencyModal').style.display = 'none';
    currentQuestionIndex = 0;
    importanceScore = 0;
    urgencyScore = 0;
}

function showQuestion() {
    document.getElementById('question-container').innerText = currentQuestions[currentQuestionIndex].question;
    document.getElementById('question-number').innerText = `Question ${currentQuestionIndex + 1}/${currentQuestions.length}`;
    document.getElementById('nextQuestionBtn').style.display = 'none';
}

function answerQuestion(answer) {
    const questionType = currentQuestions[currentQuestionIndex].type;
    if (answer === 'yes') {
        if (questionType === 'importance') {
            importanceScore++;
        } else if (questionType === 'urgency') {
            urgencyScore++;
        } else if (questionType === 'both') {
            importanceScore++;
            urgencyScore++;
        }
    }
    currentQuestionIndex++;

    if (currentQuestionIndex < currentQuestions.length) {
        showQuestion();
    } else {
        displayResult();
        closeModal();
    }
}

function displayResult() {
    const suggestion = determineImportanceUrgency();
    document.getElementById('resultText').innerText = `Based on your answers, the task is: ${suggestion}`;
    openResultModal();
}

function determineImportanceUrgency() {
    const totalQuestions = currentQuestions.length;
    const importancePercentage = (importanceScore / totalQuestions) * 100;
    const urgencyPercentage = (urgencyScore / totalQuestions) * 100;

    if (importancePercentage >= 50 && urgencyPercentage >= 50) {
        return "Urgent and Important";
    } else if (importancePercentage >= 50) {
        return "Important but Not Urgent";
    } else if (urgencyPercentage >= 50) {
        return "Urgent but Not Important";
    } else {
        return "Not Urgent and Not Important";
    }
}

function openResultModal() {
    document.getElementById('resultModal').style.display = 'block';
}

function closeResultModal() {
    document.getElementById('resultModal').style.display = 'none';
}

function startTutorial() {
    introJs().setOptions({
        steps: [
            {
                intro: "Welcome to the Task Manager! Let's go through the core features."
            },
            {
                element: '.add-task-btn',
                intro: 'Click here to add a new task.'
            },
            {
                element: '#do-this',
                intro: 'These are urgent and important tasks. Do them immediately to prevent any negative consequences.'
            },
            {
                element: '#decide-this',
                intro: 'These tasks are important but not urgent. Schedule them to be done at a later time.'
            },
            {
                element: '#delegate-this',
                intro: 'These tasks are urgent but not important. Delegate them to others if possible.'
            },
            {
                element: '#delete-this',
                intro: 'These tasks are neither urgent nor important. Consider eliminating them.'
            },
            {
                element: '.filter-sort',
                intro: 'Use these options to filter, sort and search your tasks.'
            },
            {
                element: '.completed-tasks',
                intro: 'Completed tasks will appear here.'
            },
            {
                element: '.header-icon[href="./Calendar/calendar.html"]',
                intro: 'Click here to view the calendar.'
            },
            {
                element: '.openbtn',
                intro: 'Click here to open the sidebar menu.'
            },
            {
                element: '.header-icon[onclick="startTutorial()"]',
                intro: 'Click this icon anytime to replay the tutorial. Enjoy ^^ '
            }
        ]
    }).start();
}
