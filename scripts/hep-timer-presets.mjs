// Each duration is a verbatim part of a specific written dose. A change to that
// wording requires revisiting the corresponding shortcuts before publishing.
const durationsByProgram = {
    'insertional-achilles-tendinopathy-exercises': {
        'Seated heel lift and hold': [['Hold', '15 to 30 seconds'], ['Rest', '45 to 60 seconds']],
        'Slow seated calf raise': [['Rest', '1 minute']],
        'Supported standing calf raise': [['Rest', '1 to 2 minutes']]
    },
    'proximal-hamstring-tendinopathy-exercises': {
        'Lying heel press': [['Hold', '15 to 30 seconds'], ['Rest', '45 to 60 seconds']],
        'Slow two-leg bridge': [['Rest', '1 to 2 minutes']],
        'Supported low step-up': [['Rest', '1 minute']],
        'Shallow hip hinge': [['Rest', '1 minute']]
    },
    'knee-osteoarthritis-exercises': {
        'Walking or cycling base': [['Activity', '5 to 10 minutes']]
    },
    'achilles-tendinopathy-exercises': {
        'Optional calf-raise isometric hold': [['Hold', '20 to 30 seconds']]
    },
    'gluteal-tendinopathy-exercises': {
        'Hip abduction isometric': [['Hold', '10 to 20 seconds']]
    },
    'lateral-ankle-sprain-exercises': {
        'Ankle pumps or alphabet': [['Movement', '1 to 2 minutes']],
        'Single-leg balance': [['Balance', '30 to 60 seconds']]
    },
    'lateral-elbow-tendinopathy-exercises': {
        'Isometric wrist extension': [['Hold', '30 seconds'], ['Rest', '60 seconds']],
        'Controlled grip': [['Hold', '5-second']]
    },
    'medial-elbow-tendinopathy-exercises': {
        'Isometric wrist flexion': [['Hold', '30 seconds'], ['Rest', '60 seconds']],
        'Controlled grip': [['Hold', '5-second']]
    },
    'patellar-tendinopathy-exercises': {
        'Spanish squat or wall-sit isometric': [['Hold', '30 to 45 seconds'], ['Rest', '1 to 2 minutes']]
    },
    'low-back-pain-exercises': {
        'Hip hinge and carry progression': [['Carry', '20 to 40 seconds']]
    },
    'hamstring-strain-exercises': {
        'Heel-dig isometric': [['Hold', '5-second']],
        'Side plank with controlled trunk work': [['Hold', '15 to 30 seconds']]
    },
    'plantar-fasciitis-exercises': {
        'Seated plantar-fascia stretch': [['Hold', '10-second']],
        'Straight-knee calf stretch': [['Hold', '30 seconds']],
        'Bent-knee calf stretch': [['Hold', '30 seconds']],
        'Seated short-foot or arch set': [['Hold', '5-second']]
    },
    'meniscus-tear-rehabilitation-exercises': {
        'Heel prop with quadriceps set': [['Hold', '5 seconds']],
        'Supported single-leg balance': [['Balance', '20 to 45 seconds']]
    },
    'advanced-meniscus-rehabilitation-exercises': {
        'Straight-line run progression': [['Starting run', '1 minute'], ['Starting walk', '2 minutes']]
    },
    'iliotibial-band-syndrome-exercises': {
        'Modified side plank': [['Hold', '15 to 30 seconds']],
        'Supported split squat': [['Starting hold', '20 to 45 seconds']]
    },
    'peroneal-tendinopathy-exercises': {
        'Supported single-leg balance': [['Balance', '30 to 60 seconds']],
        'Level walking or cycling base': [['Activity', '10 to 20 minutes']]
    },
    'tibialis-posterior-tendinopathy-exercises': {
        'Supported single-leg balance': [['Balance', '30 to 60 seconds']]
    },
    'thumb-cmc-osteoarthritis-exercises': {
        'Gentle first web-space opening': [['Hold', '20 to 30 seconds']],
        'Thumb palmar-abduction isometric': [['Hold', '5 to 10 seconds']]
    },
    'de-quervain-tenosynovitis-exercises': {
        'Light thumb-extension isometric': [['Starting hold', '10 seconds'], ['Progressed hold', '20 seconds'], ['Rest', '60 seconds']],
        'Neutral-wrist functional hold': [['Hold', '20 to 30 seconds']]
    },
    'patellofemoral-pain-return-to-running-exercises': {
        'Run-walk progression': [['Run', '1 to 4 minutes'], ['Walk', '1 minute']]
    },
    'achilles-tendinopathy-return-to-sport-exercises': {
        'Return-to-running intervals': [['Run', '1 minute'], ['Walk', '1 minute']]
    }
};

export function prescribedTimerOptions(program) {
    const timers = {};
    for (const [name, phases] of Object.entries(durationsByProgram[program.slug] || {})) {
        const exercise = program.exercises.find(item => item.name === name);
        let dose = exercise?.dose || '';
        timers[name] = phases.flatMap(([phase, phrase]) => {
            const match = /^(\d+)(?: to (\d+))?[ -](seconds?|minutes?)$/.exec(phrase);
            const location = match && new RegExp(`\\b${phrase}\\b`).exec(dose);
            if (!location) throw new Error(`Review timer for ${program.slug} / ${name}: ${phrase}`);
            dose = dose.slice(location.index + phrase.length);
            const [, minimum, maximum, unit] = match;
            const minutes = unit.startsWith('minute');
            return [minimum, maximum].filter(Boolean).map(amount => ({
                label: `${phase} ${amount} ${minutes ? 'min' : 'sec'}`,
                seconds: Number(amount) * (minutes ? 60 : 1)
            }));
        });
    }
    return timers;
}
