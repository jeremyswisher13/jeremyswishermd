// Mobile Navigation Toggle
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('open');
    navToggle.classList.toggle('active');
});

// Close mobile nav when clicking a link
navLinks.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        navToggle.classList.remove('active');
    });
});

// Navbar scroll effect
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// Active nav link highlighting based on scroll position
const sections = document.querySelectorAll('section[id]');
const navLinkElements = document.querySelectorAll('.nav-link');

function highlightNav() {
    const scrollY = window.scrollY + 120;
    sections.forEach(section => {
        const top = section.offsetTop;
        const height = section.offsetHeight;
        const id = section.getAttribute('id');
        if (scrollY >= top && scrollY < top + height) {
            navLinkElements.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === '#' + id) {
                    link.classList.add('active');
                }
            });
        }
    });
}

window.addEventListener('scroll', highlightNav);

// Intersection Observer for fade-in animations (only larger elements, not individual cards)
const fadeElements = document.querySelectorAll(
    '.about-text, .about-sidebar, .expertise-card, .media-card, .coverage-category, .contact-card, .contact-links'
);

const fadeObserver = new IntersectionObserver((entries) => {
    let visibleIndex = 0;
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            setTimeout(() => {
                entry.target.classList.add('visible');
            }, visibleIndex * 50);
            visibleIndex++;
            fadeObserver.unobserve(entry.target);
        }
    });
}, {
    threshold: 0.05,
    rootMargin: '0px 0px -20px 0px'
});

fadeElements.forEach(el => {
    el.classList.add('fade-in');
    fadeObserver.observe(el);
});

// Publication filter tabs
const filterButtons = document.querySelectorAll('.pub-filter');
const pubLists = document.querySelectorAll('.pub-list');

filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;

        // Update active button
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Show/hide pub lists
        pubLists.forEach(list => {
            if (list.id === filter) {
                list.classList.remove('hidden');
            } else {
                list.classList.add('hidden');
            }
        });
    });
});
