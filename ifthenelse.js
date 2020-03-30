'use strict';

const INDEX_SIZE = 6;
const OFFSET_SIZE = 5;
const BLOCK_SIZE = 3 + 2 * (OFFSET_SIZE + INDEX_SIZE);

const TOTAL_ENTRIES = 64;

// Total size: 1,600 bits (200 bytes) organized in 64 blocks made of a 25-bits-wide word each
let memory = [
	// 25-bits block
	// Minimum size for useful work is ?? bits.
	//   (??-bits block allows to support only 16 total if-else instructions,
	//    which doesn't seem to be practical.
	//    23-bits block is the minimal, but it only has a singular if/else.
	//    25 bits enables 3 if-elses; 27: 5, 29: 9, 31: 17, 32: 16;
    //
	//    37: 55 (256 bytes)
	//    39: 105, 41: 200,
	//    43: 381 (2 kB)
	//    45: 728, 47: 1394, 49: 2675, 51: 5140, 53: 9892,
	//    55: 19,065; 57: 36,792;
	//    59: 71,090 (demanding 512 kB)
	[
		// 3 bits of MUX inputs
		0, // 0000 if
		0, // 0001 then
		0, // 0010 else

		// 2 11-bit destination copy addresses (5-bits word offset + 6 bits RAM index entry)

		// Target offset 1
		// 00000: if
		// 00001: then
		// 00010: else
		// 00011+: reprogram an address bit (see next bits)
		//   00011: bit  0 of dst 1
		//   01101: bit 10 of dst 1
		//   01110: bit  0 of dst 2
		//   11000: bit 10 of dst 2

		0, 0, 0, 0, 0, 

		// "index 1", block pointer inside of memory. Size depends on the size of RAM.

		0, 0, 0, 0,	0, 0,


		// Target offset 2
		// 00000: if
		// 00001: then
		// 00010: else
		// 00011+: reprogram an address bit (see next bits)
		//   00011: bit  0 of dst 1
		//   01101: bit 10 of dst 1
		//   01110: bit  0 of dst 2
		//   11000: bit 10 of dst 2

		0, 0, 0, 0, 0, 

		// "index 2", block pointer inside of memory. Size depends on the size of RAM.

		0, 0, 0, 0,	0, 0,
	]
];

const ptr1_index = (index, memory) => {
	const res = [
		memory[index][3 + OFFSET_SIZE + 0],
		memory[index][3 + OFFSET_SIZE + 1],
		memory[index][3 + OFFSET_SIZE + 2],
		memory[index][3 + OFFSET_SIZE + 3],
		memory[index][3 + OFFSET_SIZE + 4],
		memory[index][3 + OFFSET_SIZE + 5]
	];

	return res[0]      +
		   res[1] * 2  +
		   res[2] * 4  +
		   res[3] * 8  +
		   res[4] * 16 +
		   res[5] * 32;
}


const ptr2_index = (index, memory) => {
	const res = [
		memory[index][3 + INDEX_SIZE + 2 * OFFSET_SIZE + 0],
		memory[index][3 + INDEX_SIZE + 2 * OFFSET_SIZE + 1],
		memory[index][3 + INDEX_SIZE + 2 * OFFSET_SIZE + 2],
		memory[index][3 + INDEX_SIZE + 2 * OFFSET_SIZE + 3],
		memory[index][3 + INDEX_SIZE + 2 * OFFSET_SIZE + 4],
		memory[index][3 + INDEX_SIZE + 2 * OFFSET_SIZE + 5]
	];

	return res[0]      +
		   res[1] * 2  +
		   res[2] * 4  +
		   res[3] * 8  +
		   res[4] * 16 +
		   res[5] * 32;
}


const ptr1_offset = (index, memory) => {
	const res = [
		memory[index][3 + 0],
		memory[index][3 + 1],
		memory[index][3 + 2],
		memory[index][3 + 3],
		memory[index][3 + 4]
	];

	return res[0]      +
		   res[1] * 2  +
		   res[2] * 4  +
		   res[3] * 8  +
		   res[4] * 16;
}

const ptr2_offset = (index, memory) => {
	const res = [
		memory[index][3 + INDEX_SIZE + OFFSET_SIZE + 0],
		memory[index][3 + INDEX_SIZE + OFFSET_SIZE + 1],
		memory[index][3 + INDEX_SIZE + OFFSET_SIZE + 2],
		memory[index][3 + INDEX_SIZE + OFFSET_SIZE + 3],
		memory[index][3 + INDEX_SIZE + OFFSET_SIZE + 4]
	];

	return res[0]      +
		   res[1] * 2  +
		   res[2] * 4  +
		   res[3] * 8  +
		   res[4] * 16;
}

// Cache of MUX evaluations. In real world just flip-flops.
const internal_memory = Array(TOTAL_ENTRIES).fill(0);

// Evaluates MUXes without caching the first time
let first_time = true;

const initial = () => {
	// Mark everything as dirty
	for (let index = 0; index < TOTAL_ENTRIES; ++index) {
		for (let offset = 0; offset < BLOCK_SIZE; ++offset) {
			memcpy_list.push([offset, index]);
		}
	}
};

// Main execution unit. Scalable from sequential memory access one write or one read at a time;
//                               up to omega-network packet-switched routing to destination bits
//                               with full parallel execution
//                               (still limited by the depth of the network; _perhaps_ pipelineable).
let memcpy_list = [];

// Parallel structure for bookkeeping; linearly scalable.
let dirty_blocks = {};

const update_dirty_block = (index, offset) => {

	const dirty_block = dirty_blocks[index] || { mux: 0, ptr1: 0, ptr2: 0 };

	if (offset < 3) {
		++dirty_block.mux;
	} else if (offset >= 3 && offset < (3 + INDEX_SIZE + OFFSET_SIZE)) {
		++dirty_block.ptr1;
	} else {
		++dirty_block.ptr2;
	}

	dirty_blocks[index] = dirty_block;
};

const update_cycle = (debug) => {

	'use strict';

	if (debug) {
		console.log(dirty_blocks, 'MEMORY CONTENTS BEFORE UPDATE:');
		for (let index = 0; index < 16; ++index) {
			const block = memory[index];
			console.debug(`[${ index }] ${ block[0] } ? ${ block[1] } : ${ block[2] }`);
		}
		console.log('\nMEMFLIP INSTRUCTIONS:');
		for (let memcpy_instr = 0; memcpy_instr < memcpy_list.length; ++memcpy_instr) {
			const [offset, index] = memcpy_list[memcpy_instr];
			console.debug(`at ${ index } bit ${ offset }`);
		}
	}

	// Indexes of changed internal flip-flops to emulate clock-to-output delay
	const emulate_internal_ff_delay = [];

	// Execute scheduled memcpy
	for (let memcpy_instr = 0; memcpy_instr < memcpy_list.length; ++memcpy_instr) {
		const [offset, index] = memcpy_list[memcpy_instr];

		const block = memory[index];

		if (debug) {
			const was = block[offset];
			const became = was ? 0 : 1;
			const log_string = `AT ${ index } FLIP ONE BIT ${ offset } FROM ${ was } TO ${ became } `;
			console.log(log_string);
		}

		// Flip a bit
		block[offset] = block[offset] ? 0 : 1;

		update_dirty_block(index, offset);
	}

	if (debug) {
		console.debug('DIRTY:\n', dirty_blocks);
	}

	// Clear the list
	memcpy_list = [];

	// Recompute all dirty blocks
	Object.keys(dirty_blocks).forEach(txt_index => {
		'use strict';
		const index = parseInt(txt_index);

		const block = memory[index];
		if (debug) {
			console.debug(`in [${ index }] ${ block[0] } ? ${ block[1] } : ${ block[2] }`);
		}

		const dirty_block = dirty_blocks[index];

		let evaluation_changed = false;

		// Evaluate a MUX:
		const next_value = block[0] ? block[1] : block[2];

		// If any of MUX inputs has changed:
		if (dirty_block.mux) {

			const prev_mux_value = internal_memory[index];

			if (debug) {
				console.debug(`MUX ${ index }: ${ prev_mux_value } --> ${ block[0] } ? ${ block[1] } : ${ block[2] } --> ${ next_value }`);
			}

			if (prev_mux_value !== next_value) { // || first_time) {
				evaluation_changed = true;
				if (debug) {
					console.debug(`------------ MUX ${ index } changed ------------`);
				}
				emulate_internal_ff_delay.push(index);
			}
		}

		if (evaluation_changed || dirty_block.ptr1) {
			// Schedule one or two memcpy operations (flip a bit operations)
			const target1 = [ ptr1_offset(index, memory), ptr1_index(index, memory) ];

			// Non-zero pointers will be updated;
			// The cause is MUX result has changed.
			// If pointers themselves have changed,
			// it also should cause an update
			if (target1[0] || target1[1]) {
				// TODO FIXME BUGBUG a hack to access memory existing value
				const prev_value = memory[target1[1]][target1[0]];
				if (next_value !== prev_value) {
					memcpy_list.push(target1);
				}
			}
		}


		if (evaluation_changed || dirty_block.ptr2) {
			const target2 = [ ptr2_offset(index, memory), ptr2_index(index, memory) ];

			if (target2[0] || target2[1]) {
				// TODO FIXME BUGBUG a hack to access memory existing value
				const prev_value = memory[target2[1]][target2[0]];
				if (next_value !== prev_value) {
					memcpy_list.push(target2);
				}
			}
		}
	});

	// Indexes of MUXes or pointers which got updated
	dirty_blocks = {};

	// Propagate internal flip-flops (results of MUX computation)
	emulate_internal_ff_delay.forEach(index => {
		// Flip a "cached MUX result" bit
		internal_memory[index] = internal_memory[index] ? 0 : 1;
	});

	if (first_time) {
		first_time = false;
	}

	if (debug) {
		console.debug('INTERNAL MEMORY:\n', internal_memory);
	}

	if (debug) {
		console.log(dirty_blocks, 'MEMORY CONTENTS AFTER UPDATE:');
		for (let index = 0; index < 16; ++index) {
			const block = memory[index];
			console.debug(`[${ index }] ${ block[0] } ? ${ block[1] } : ${ block[2] } -> ${ internal_memory[index] }`);
		}
	}
}








// Empty stuff. Does nothing
memory = Array(TOTAL_ENTRIES).fill([]);

memory = memory.map(() => Array(BLOCK_SIZE).fill(0));

const number_to_6_bits = (number) => ([
	(number >> 0) & 0b000001,
	(number >> 1) & 0b000001,
	(number >> 2) & 0b000001,
	(number >> 3) & 0b000001,
	(number >> 4) & 0b000001,
	(number >> 5) & 0b000001
]);

const add_instruction = ({ at, If, Then, Else, output1, output2 }) => {

	// Change memory content to pre-program with given if then else instruction
	const instr = [
		If,
		Then,
		Else,

		// First output should always be defined.
		// Fan-out degree of zero is a nonsense.
    	...number_to_6_bits(output1.to).slice(0, -1),
		...number_to_6_bits(output1.at),

    	...(output2 ? [
				...number_to_6_bits(output2.to).slice(0, -1),
		    	...number_to_6_bits(output2.at)
			] : Array(OFFSET_SIZE + INDEX_SIZE).fill(0)
		)
	];

	/*
	dirty_blocks[at] = {
		mux: 3,
		ptr1: OFFSET_SIZE + INDEX_SIZE,
		ptr2: output2 ? (OFFSET_SIZE + INDEX_SIZE) : 0
	};
	*/

	const target1 = [ ptr1_offset(0, [instr]), ptr1_index(0, [instr]) ];
	const target2 = [ ptr2_offset(0, [instr]), ptr2_index(0, [instr]) ];
	console.log(`[${ at }] ${ instr[0] } ? ${ instr[1] } : ${ instr[2] } -> (${target1[1]}:${target1[0]}, ${target2[1]}:${target2[0]})`);


	for (let offset = 0; offset < BLOCK_SIZE; ++offset) {

		// Flip bits
		const prev_value = memory[at][offset];
		//console.log(prev_value);
		if (instr[offset] !== prev_value) {

			memcpy_list.push([ offset, at ]);
		}// else {
		//	console.log(offset, prev_value);
		//}
	}

	// console.log(memcpy_list);

};


// Syntax sugar. Creates an offset value based on label and parameter
const bit = (label, param) => {
	switch (label) {
	case 'If': return 0;
	case 'Then': return 1;
	case 'Else': return 2;
	case 'copy1_offset': return 3 + param;
	case 'copy1_index': return 3 + OFFSET_SIZE + param;
	case 'copy1_offset': return 3 + OFFSET_SIZE + INDEX_SIZE + param;
	case 'copy1_index': return 3 + 2 * OFFSET_SIZE + INDEX_SIZE + param;
	}
	throw Error('wrong label');
};

const direct_bit = (value, { at, offset }) => {

	const prev_value = memory[at][offset];
	if (value != prev_value) {
		memcpy_list.push([ offset, at ]);
	}
};

// Manual memory transfer operation to provide an external IO input.
const write_a_bit = (value, { at, label, param }) => {
	const offset = bit(label, param);

	direct_bit(value, { at, offset });

	// console.log(`at ${ at} offset ${ offset }`);
	// console.log('WRITE A BIT COPY LIST:', memcpy_list);
};


const NOT = { If: 0, Then: 0, Else: 1 };
const AND = { If: 0, Then: 0, Else: 0 };
const IMPLY = { If: 0, Then: 0, Else: 1 };
const ADJUNCT = { If: 0, Then: 0, Else: 0 };
const OR = { If: 0, Then: 1, Else: 0 };

const FANOUT = { If: 0, Then: 1, Else: 0 };
const MUX = { If: 0, Then: 0, Else: 0 };

// A       B
// A1  A2  B1   - 2 fan-out modules
// A1 ~A2  B1   - 1 not module + 1 fan-out module
//    XOR       - 1 MUX module to get XOR
// IO out       - 1 fan-out target to do IO output



// TIME + 1 -----------------------------------------

// 2 copies of A (delayed + 1)
// console.log('[1] 0 ? 1 : 0 -> (4:0, 5:0) - supposed to be');

add_instruction({ at: 1, ...FANOUT, output1: { to: bit('If'), at: 4 }, output2: { to: bit('If'), at: 5 } });


// 1 copy of B (delayed + 1)
add_instruction({ at: 2, ...FANOUT, output1: { to: bit('If'), at: 3 }});


// TIME + 2 -------------------------------------------

// 1 more copy of B (delayed + 2) - goes to "If" of the XOR mux
add_instruction({ at: 3, ...FANOUT, output1: { to: bit('If'), at: 6 }});


// 1 copy of A (delayed + 2) - goes to "Else" of the XOR mux
add_instruction({ at: 4, ...FANOUT, output1: { to: bit('Else'), at: 6 }});


// Inverted copy of A - goes to "Then" of the XOR mux
add_instruction({ at: 5, ...NOT, output1: { to: bit('Then'), at: 6 }});


// TIME + 3: uses all 3 copies ----------------------

// XOR mux
add_instruction({ at: 6, ...MUX, output1: { to: bit('If'), at: 7 }});


// TIME + 4: write-out the result ----------------------

// XOR result (write-only); target: 'If'
add_instruction({ at: 7, ...FANOUT, output1: { to: 0, at: 0 } });


// Invertor targeting itself
add_instruction({ at: 8, ...NOT, output1: { to: bit('If'), at: 8 }});


const results = (memory) => ({
	a_0: memory[1][bit('If')],
	b_0: memory[2][bit('If')],

	a_1: memory[4][bit('If')],
	more_a_1: memory[5][bit('If')],

	b_1: memory[3][bit('If')],


	not_a_2: memory[6][bit('Then')],
	a_2: memory[6][bit('Else')],
	b_2: memory[6][bit('If')],

	xor: memory[7][bit('If')],

	generator: memory[8][bit('If')],
});

let total_ticks = 0;

const dump_memory = () => {
	memory.forEach((instr, index) => {
		const target1 = [ ptr1_offset(index, memory), ptr1_index(index, memory) ];
		const target2 = [ ptr2_offset(index, memory), ptr2_index(index, memory) ];
		console.log(`[${ index }] ${ instr[0] } ? ${ instr[1] } : ${ instr[2] } -> (${target1[1]}:${target1[0]}, ${target2[1]}:${target2[0]})`);
	});
};

const run_clocks = (clocks, { debug } = {}) => {

	while (memcpy_list.length) {
		++total_ticks;
		console.log(memcpy_list);
		update_cycle(debug);



		--clocks;
		if (!clocks) {
			break;
		}
	}

	console.log('\n');
	// console.log(results(memory));
}


// run_clocks(4, { debug: true });
run_clocks(4);



// Flip bits (IO inputs)

// A
write_a_bit(1, { at: 1, label: 'If' });
// B
write_a_bit(1, { at: 2, label: 'If' });

run_clocks(4);

//run_clocks(4, { debug: true });

run_clocks(1);
run_clocks(1);
run_clocks(1);

dump_memory();
console.log('------------------------- Pipeline');

write_a_bit(0, { at: 1, label: 'If' });
write_a_bit(1, { at: 2, label: 'If' });
run_clocks(1);

write_a_bit(0, { at: 1, label: 'If' });
write_a_bit(0, { at: 2, label: 'If' });
run_clocks(1);

write_a_bit(1, { at: 1, label: 'If' });
write_a_bit(0, { at: 2, label: 'If' });
run_clocks(1);

write_a_bit(1, { at: 1, label: 'If' });
write_a_bit(1, { at: 2, label: 'If' });
run_clocks(1);

run_clocks(1);
run_clocks(1);

run_clocks(1);

let zeroes = 0;
let ones = 0;

memory.forEach((elt, index) => elt.forEach((value, offset) => {
	const random_value = Math.floor(Math.random() * 2);
	if (random_value) {
		++ones;
	} else {
		++zeroes;
	}

	direct_bit(random_value, { at: index, offset })
}));

run_clocks(4000);

dump_memory();

console.log(`Program ran ${ total_ticks } ticks. ${ memcpy_list.length } memcpy instructions left in buffer. RNG probability was ${
	zeroes * (100 / (zeroes + ones)) } / ${ ones * (100 / (zeroes + ones)) } zeroes/ones.`);

