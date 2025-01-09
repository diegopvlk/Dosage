export default function upgradeItems(json, type) {
	// change old versions for compatibility
	if (type === 'treatments' && json.meds) {
		const newTreatments = {
			treatments: [],
			lastUpdate: '',
		};

		json.meds.forEach(item => {
			const info = item.info || item._info;
			const dur = info.duration;
			const icon = info.icon.replace('-symbolic', '');
			info.dosage.forEach(d => {
				d.lastTaken = null;
				delete d.updated;
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
			const rcInterval = info.recurring?.interval || 5;

			const newMed = {
				name: item.name || item._name,
				unit: item.unit || item._unit,
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
			history: [],
		};

		json.meds.forEach(item => {
			const date = item.date || item._date;
			const info = item.info || item._info;

			const taken = item.taken || item._taken;
			const takenValue = taken === 'yes' ? 1 : taken === 'no' ? 0 : -1;

			newHistory.history.push({
				name: item.name || item._name,
				unit: item.unit || item._unit,
				time: info.time,
				dose: info.dose,
				color: item.color || item._color,
				taken: [new Date(date).getTime(), takenValue],
			});
		});

		return newHistory;
	} else if (type === 'history' && !Array.isArray(json.history)) {
		const newHistory = {
			history: [],
		};

		const historyObj = json.history;
		const historyKeys = Object.keys(historyObj);
		historyKeys.forEach(dateKey => {
			historyObj[dateKey].forEach(item => {
				newHistory.history.push(item);
			});
		});

		return newHistory;
	}
}
