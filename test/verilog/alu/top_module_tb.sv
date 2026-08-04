// ============================================================================
// Archivo: top_module_tb.sv
// Descripción: Suite de pruebas autodidacta (Self-Checking Testbench) para
//              top_module. Precarga valores en el Register File (Backdoor Access),
//              aplica estímulos y verifica automáticamente los resultados y flags.
// ============================================================================

/* verilator lint_off IMPORTSTAR */
import tp1_pkg::*;

module top_module_tb (
    input  logic clk    // Los tb en System Verilog puro no necesitan estos puertos.
                        // En este caso Verilator gestiona el avance del clk (ver archivo cpp).
);

    logic rst;
    logic start;
    logic [ADDR_WIDTH-1:0] rs1;
    logic [ADDR_WIDTH-1:0] rs2;
    logic [ADDR_WIDTH-1:0] rd;
    logic [2:0] opcode;
    logic ready;
    logic done;
    logic [3:0] flags_out;

    integer fail_count = 0;
    integer pass_count = 0;

    alu_flags_t flags_struct;

    // Instanciación del DUT (top_module)
    top_module #(
        .DATA_WIDTH(DATA_WIDTH),
        .ADDR_WIDTH(ADDR_WIDTH)
    ) u_top_module (
        .clk      (clk),
        .rst      (rst),
        .start    (start),
        .rs1      (rs1),
        .rs2      (rs2),
        .rd       (rd),
        .opcode   (opcode),
        .ready    (ready),
        .done     (done),
        .alu_flags(flags_struct)
    );

    // Extracción de banderas {z, n, c, v}
    assign flags_out = {flags_struct.z,
                        flags_struct.n,
                        flags_struct.c,
                        flags_struct.v};

    // Task 1: Secuencia de Reset (Activo en Alto)
    task automatic do_reset();
        rst    = 1'b1; // Activo en alto
        start  = 1'b0;
        rs1    = '0;
        rs2    = '0;
        rd     = '0;
        opcode = '0;
        repeat (3) @(posedge clk);
        rst    = 1'b0; // Desactivar reset
        @(posedge clk);
    endtask

    // Task 2: Precarga Backdoor del Banco de Registros
    task automatic preload_registers();
        $display("[TB] Precargando valores conocidos en el Banco de Registros (Backdoor Access)...");
        u_top_module.u_reg_file.rf[1] = 32'd10;          // R1 = 10
        u_top_module.u_reg_file.rf[2] = 32'd20;          // R2 = 20
        u_top_module.u_reg_file.rf[3] = 32'hFFFF_FFFB;   // R3 = -5
        u_top_module.u_reg_file.rf[4] = 32'h8000_0000;   // R4 = 0x80000000 (MSB activo)
        u_top_module.u_reg_file.rf[5] = 32'd0;
        $display("[TB] Registros inicializados: R1=%0d, R2=%0d, R3=%0d (0x%0h), R4=0x%0h",
                 u_top_module.u_reg_file.rf[1], u_top_module.u_reg_file.rf[2],
                 $signed(u_top_module.u_reg_file.rf[3]), u_top_module.u_reg_file.rf[3],
                 u_top_module.u_reg_file.rf[4]);
    endtask

    // Task 3: Ejecución de Instrucción y Verificación Autochequeable
    task automatic run_and_check(
        input string                 test_id,
        input string                 test_name,
        input logic [ADDR_WIDTH-1:0] rs1_in,
        input logic [ADDR_WIDTH-1:0] rs2_in,
        input logic [ADDR_WIDTH-1:0] rd_in,
        input logic [2:0]            op_in,
        input logic [DATA_WIDTH-1:0] expected_res,
        input logic [3:0]            expected_flags, // {z, n, c, v}
        input bit                    check_flags_cv_only
    );
        logic [DATA_WIDTH-1:0] actual_res;
        logic [3:0]            actual_flags;
        integer timeout;

        // Esperar a que la FSM esté lista (ready == 1)
        while (!ready) @(posedge clk);

        // Enviar estímulo
        start  = 1'b1;
        rs1    = rs1_in;
        rs2    = rs2_in;
        rd     = rd_in;
        opcode = op_in;

        @(posedge clk);
        start  = 1'b0;

        // Esperar pulso done
        timeout = 0;
        while (!done && timeout < 20) begin
            @(posedge clk);
            timeout++;
        end

        if (!done) begin
            $error("[FAIL] %s - %s: TIMEOUT esperando señal done!", test_id, test_name);
            fail_count++;
            return;
        end

        // Capturar resultado de la ALU durante WRITEBACK
        actual_res   = u_top_module.alu_io.result;
        actual_flags = flags_out;

        // Evaluación de condiciones
        if (check_flags_cv_only) begin
            // Verificar estricto C=0 y V=0 en operaciones lógicas
            if (actual_res == expected_res && actual_flags[1] == 1'b0 && actual_flags[0] == 1'b0) begin
                $display("[PASS] %s - %s | Resultado=0x%0h (%0d), Flags={Z:%b, N:%b, C:%b, V:%b}",
                         test_id, test_name, actual_res, $signed(actual_res),
                         actual_flags[3], actual_flags[2], actual_flags[1], actual_flags[0]);
                pass_count++;
            end else begin
                $error("[FAIL] %s - %s | Esperado: Res=0x%0h (C=0, V=0) | Obtenido: Res=0x%0h, Flags={Z:%b, N:%b, C:%b, V:%b}",
                       test_id, test_name, expected_res, actual_res,
                       actual_flags[3], actual_flags[2], actual_flags[1], actual_flags[0]);
                fail_count++;
            end
        end else begin
            if (actual_res == expected_res && actual_flags == expected_flags) begin
                $display("[PASS] %s - %s | Resultado=0x%0h (%0d), Flags={Z:%b, N:%b, C:%b, V:%b}",
                         test_id, test_name, actual_res, $signed(actual_res),
                         actual_flags[3], actual_flags[2], actual_flags[1], actual_flags[0]);
                pass_count++;
            end else begin
                $error("[FAIL] %s - %s | Esperado: Res=0x%0h, Flags=%4b | Obtenido: Res=0x%0h, Flags=%4b {Z:%b, N:%b, C:%b, V:%b}",
                       test_id, test_name, expected_res, expected_flags, actual_res, actual_flags,
                       actual_flags[3], actual_flags[2], actual_flags[1], actual_flags[0]);
                fail_count++;
            end
        end

        @(posedge clk);
    endtask

    // Task 4: Verificación específica del Registro R0 hardwired
    task automatic verify_r0();
        $display("--------------------------------------------------------");
        $display("[TB] Verificando que R0 permanezca strictly en 0...");
        if (u_top_module.u_reg_file.rf[0] == 32'd0) begin
            $display("[PASS] Test D - Registro R0 no sufrió modificaciones en el arreglo interno.");
            pass_count++;
        end else begin
            $error("[FAIL] Test D - R0 fue modificado en el arreglo interno! Valor: %0d", u_top_module.u_reg_file.rf[0]);
            fail_count++;
        end
    endtask

    // Proceso Principal del Testbench
    initial begin
        do_reset();
        preload_registers();

        $display("\n========================================================");
        $display("       EJECUTANDO SUITE DE PRUEBAS AUTOMÁTICAS         ");
        $display("========================================================");

        // --------------------------------------------------------------------
        // Test A: Operación ADD (10 + 20 = 30)
        // --------------------------------------------------------------------
        run_and_check("Test A", "ADD R1 (10) + R2 (20) -> R5",
                      5'd1, 5'd2, 5'd5, 3'b000 /* OP_ADD */,
                      32'd30, 4'b0000 /* Z=0, N=0, C=0, V=0 */, 0);

        // --------------------------------------------------------------------
        // Test B: Operaciones SUB (Restas y Banderas N / Z)
        // --------------------------------------------------------------------
        // Test B.1: Resta con resultado negativo (10 - 20 = -10)
        run_and_check("Test B.1", "SUB R1 (10) - R2 (20) -> R6 (N=1)",
                      5'd1, 5'd2, 5'd6, 3'b001 /* OP_SUB */,
                      32'hFFFF_FFF6, 4'b0110 /* Z=0, N=1, C=1, V=0 */, 0);

        // Test B.2: Resta con resultado cero (10 - 10 = 0)
        run_and_check("Test B.2", "SUB R1 (10) - R1 (10) -> R7 (Z=1)",
                      5'd1, 5'd1, 5'd7, 3'b001 /* OP_SUB */,
                      32'd0, 4'b1000 /* Z=1, N=0, C=0, V=0 */, 0);

        // --------------------------------------------------------------------
        // Test C: Operaciones Lógicas AND / OR (Verificación C=0 y V=0)
        // --------------------------------------------------------------------
        // Test C.1: AND R3 (-5) & R4 (0x80000000)
        run_and_check("Test C.1", "AND R3 (-5) & R4 (0x80000000) -> R8 (Fuerza C=0, V=0)",
                      5'd3, 5'd4, 5'd8, 3'b010 /* OP_AND */,
                      32'h8000_0000, 4'b0100 /* Z=0, N=1, C=0, V=0 */, 1);

        // Test C.2: OR R1 (10) | R2 (20)
        run_and_check("Test C.2", "OR R1 (10) | R2 (20) -> R9 (Fuerza C=0, V=0)",
                      5'd1, 5'd2, 5'd9, 3'b011 /* OP_OR */,
                      32'd30, 4'b0000 /* Z=0, N=0, C=0, V=0 */, 1);

        // --------------------------------------------------------------------
        // Test D: Intento de Escritura en Registro R0
        // --------------------------------------------------------------------
        run_and_check("Test D.1", "ADD R1 (10) + R2 (20) -> R0 (Escritura en R0)",
                      5'd1, 5'd2, 5'd0, 3'b000 /* OP_ADD */,
                      32'd30, 4'b0000 /* Z=0, N=0, C=0, V=0 */, 0);
        verify_r0();

        // Lectura de R0 mediante suma R0 + R0 -> R10
        run_and_check("Test D.2", "ADD R0 + R0 -> R10 (Verifica lectura de R0)",
                      5'd0, 5'd0, 5'd10, 3'b000 /* OP_ADD */,
                      32'd0, 4'b1000 /* Z=1, N=0, C=0, V=0 */, 0);

        // --------------------------------------------------------------------
        // Test E: Opcode Inválido
        // --------------------------------------------------------------------
        run_and_check("Test E", "Opcode Inválido (7) R1, R2 -> R11 (N=1, Res=0)",
                      5'd1, 5'd2, 5'd11, 3'b111 /* Inválido */,
                      32'd0, 4'b0100 /* Z=0, N=1, C=0, V=0 */, 0);

        // --------------------------------------------------------------------
        // Resumen Final
        // --------------------------------------------------------------------
        $display("\n========================================================");
        if (fail_count == 0) begin
            $display("           ALL TESTS PASSED SUCCESSFULLY!             ");
            $display("           (%0d PRUEBAS EJECUTADAS Y PASADAS)          ", pass_count);
        end else begin
            $display("   ¡SE DETECTARON %0d ERRORES EN LA SIMULACIÓN!          ", fail_count);
        end
        $display("========================================================\n");

        $finish;
    end

endmodule
