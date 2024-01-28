const iconsHolder = [];

export default function upgradeItems(json, type) {
	// change old versions for compatibility
	if (type === 'treatments' && json.meds) {
		const newTreatments = {
			treatments: [],
			lastUpdate: '',
		};

		json.meds.forEach(item => {
			const info = item.info;
			const dur = info.duration;
			const icon = item.info.icon.replace('-symbolic', '');

			iconsHolder.push({
				name: item.name,
				icon: icon,
			});

			// change to int and to parse in ms instead of seconds
			if (typeof dur.start === 'string') {
				dur.start = +dur.start * 1000;
				// add duration.end if doesn't exist
				dur.end = +dur.end * 1000 || dur.start;
			}

			if (!info.lastUpdate) {
				info.lastUpdate = new Date().toISOString();
			}

			// v1.1.0 only has recurring: boolean
			const rcEnabled = info.recurring?.enabled || info.recurring === true;
			const rcInterval = info.recurring.interval || 5;

			const newMed = {
				name: item.name,
				unit: item.unit,
				notes: info.notes,
				frequency: info.frequency,
				color: info.color,
				icon: icon,
				days: info.days,
				cycle: info.cycle,
				dosage: info.dosage,
				recurring: {
					enabled: rcEnabled,
					interval: rcInterval,
				},
				inventory: info.inventory,
				duration: info.duration,
			};

			newTreatments.lastUpdate = info.lastUpdate;
			newTreatments.treatments.push(newMed);
		});

		return newTreatments;
	}

	if (type === 'history' && json.meds) {
		const newHistory = {
			history: {},
		};
		const hist = newHistory.history;

		json.meds.forEach(item => {
			const dateKey = new Date(item.date).setHours(0, 0, 0, 0);

			if (!hist[dateKey]) {
				hist[dateKey] = [];
			}

			let icon = 'pill';

			iconsHolder.forEach(i => {
				if (i.name.toLowerCase() === item.name.toLowerCase()) {
					icon = i.icon;
				}
			});

			const takenValue =
				item.taken === 'yes' ? 1 : item.taken === 'no' ? 0 : -1;

			hist[dateKey].push({
				name: item.name,
				unit: item.unit,
				icon: icon,
				time: item.info.time,
				dose: item.info.dose,
				color: item.color,
				taken: [new Date(item.date).getTime(), takenValue],
			});
		});

		return newHistory;
	}
}
