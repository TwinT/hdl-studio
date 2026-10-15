module pc (
    input  logic        clk,
    input  logic        rst,     // sinc, activo alto
    input  logic        ld,      // carga bus en val
    input  logic        inc,     // val <= val + 4
    input  logic        oe,      // pone val en el bus
    inout  logic [31:0] bus,
    output logic [31:0] val,
    output logic [31:0] instr_pc  // val en el último oe: la dirección de la instrucción en ir
);

    always_ff @(posedge clk) begin
        if (rst) begin
            val      <= 32'd0;
            instr_pc <= 32'd0;
        end else begin
            if (ld) begin
                val <= bus;
            end else if (inc) begin
                val <= val + 32'd4;
            end

            if (oe) begin
                instr_pc <= val;
            end
        end
    end

    assign bus = oe ? val : 32'bZ;

endmodule
