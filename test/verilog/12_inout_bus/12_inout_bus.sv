// Bus compartido bidireccional con puertos `inout`: cada modulo conectado al
// bus lo lee y/o lo maneja a traves de UN solo puerto, como en un bus real.
//
//   bus_reg   : registro que maneja el bus (oe) y lo carga (ld)
//   bus_probe : solo lee el bus
//   bus_pair  : no hace nada con el bus, lo pasa hacia dos bus_reg
//   inout_bus : el top; `drive`/`data` son un driver externo (un "cuarto" modulo)
//
// HDL Studio parte cada inout en una entrada `bus` y una salida `bus__out`
// (solo lo que el modulo maneja) y junta todos los drivers con un TriMerge.
module bus_reg (
    input  logic       clk,
    input  logic       ld,   // carga el bus en val
    input  logic       oe,   // pone val en el bus
    inout  logic [3:0] bus
);
    logic [3:0] val;

    always_ff @(posedge clk) begin
        if (ld) val <= bus;
    end

    assign bus = oe ? val : 4'bz;
endmodule

module bus_probe (
    input  logic       clk,
    inout  logic [3:0] bus,
    output logic [3:0] seen  // ultimo valor del bus en un flanco de clk
);
    always_ff @(posedge clk) seen <= bus;
endmodule

module bus_pair (
    input  logic       clk,
    input  logic       ld_a, oe_a, ld_b, oe_b,
    inout  logic [3:0] bus
);
    bus_reg a (.clk(clk), .ld(ld_a), .oe(oe_a), .bus(bus));
    bus_reg b (.clk(clk), .ld(ld_b), .oe(oe_b), .bus(bus));
endmodule

module inout_bus (
    input  logic       clk,
    input  logic       ld_a, oe_a, ld_b, oe_b,
    input  logic       drive,
    input  logic [3:0] data,
    output logic [3:0] seen
);
    wire [3:0] bus;

    assign bus = drive ? data : 4'bz;

    bus_pair  pair  (.clk(clk), .ld_a(ld_a), .oe_a(oe_a), .ld_b(ld_b), .oe_b(oe_b), .bus(bus));
    bus_probe probe (.clk(clk), .bus(bus), .seen(seen));
endmodule
