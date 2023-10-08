'use strict';

import GObject from 'gi://GObject';

export const Medication = GObject.registerClass({
	GTypeName: 'Medication',
	Properties: {
		name: GObject.ParamSpec.string(
			'name',
			'Name',
			'Name of medication',
			GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
			''
		),
		unit: GObject.ParamSpec.string(
			'unit',
			'Unit',
			'Unit of medication',
			GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
			''
		),
		info: GObject.ParamSpec.jsobject(
			'info',
			'Info',
			'Info of medication',
			GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
			{}
		),
	},
},
class extends GObject.Object {
	get name() {
		return this._name;
	}
	set name(name) {
		if (this._name === name) return;
		this._name = name;
		this.notify('name');
	}

	get unit() {
		return this._unit;
	}
	set unit(unit) {
		if (this._unit === unit) return;
		this._unit = unit;
		this.notify('unit');
	}

	get info() {
		return this._info;
	}
	set info(info) {
		if (this._info === info) return;
		this._info = info;
		this.notify('info');
	}
});

export const HistoryMedication = GObject.registerClass({
	GTypeName: 'HistoryMedication',
	Properties: {
		name: GObject.ParamSpec.string(
			'name',
			'Name',
			'Name of medication',
			GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
			null
		),

		info: GObject.ParamSpec.jsobject(
			'info',
			'Info',
			'Info of medication',
			GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
			{}
		),

		unit: GObject.ParamSpec.string(
			'unit',
			'Unit',
			'Unit of medication',
			GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
			null
		),

		color: GObject.ParamSpec.string(
			'color',
			'Color',
			'Color of medication',
			GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
			null
		),

		taken: GObject.ParamSpec.string(
			'taken',
			'Taken',
			'If the medication was taken or not',
			GObject.ParamFlags.READWRITE,
			''
		),

		date: GObject.ParamSpec.string(
			'date',
			'Date',
			'Date of the medication taken or not',
			GObject.ParamFlags.READWRITE,
			''
		),
	},
},
class extends GObject.Object {
	get name() {
		return this._name;
	}
	set name(name) {
		if (this._name === name) return;
		this._name = name;
		this.notify('name');
	}

	get unit() {
		return this._unit;
	}
	set unit(unit) {
		if (this._unit === unit) return;
		this._unit = unit;
		this.notify('unit');
	}

	get color() {
		return this._color;
	}
	set color(unit) {
		if (this._color === unit) return;
		this._color = unit;
		this.notify('color');
	}
	
	get taken() {
		return this._taken;
	}
	set taken(taken) {
		if (this._taken === taken) return;
		this._taken = taken;
		this.notify('taken');
	}

	get info() {
		return this._info;
	}
	set info(info) {
		if (this._info === info) return;
		this._info = info;
		this.notify('info');
	}
	
	get date() {
		return this._date;
	}
	set date(date) {
		if (this._date === date) return;
		this._date = date;
		this.notify('date');
	}
});

export const TodayMedication = GObject.registerClass({
	GTypeName: 'TodayMedication',
	Properties: {
		name: GObject.ParamSpec.string(
			'name',
			'Name',
			'Name of medication',
			GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
			''
		),
		unit: GObject.ParamSpec.string(
			'unit',
			'Unit',
			'Unit of medication',
			GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
			''
		),
		info: GObject.ParamSpec.jsobject(
			'info',
			'Info',
			'Info of medication',
			GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
			{}
		),
		dose: GObject.ParamSpec.float(
			'dose',
			'Dosage',
			'Dosage of medication',
			GObject.ParamFlags.READWRITE,
			0,
			999,
			null
		),
	},
},
class extends GObject.Object {});
