// Invariantes del demo "ruleta": cada pulsación frena exactamente un dígito más, aunque el botón
// quede apretado varios pasos del giro, y ese dígito muestra su patrón. Al terminar cada ronda
// (RONDAS suma 1) los cuatro dígitos sorteados están en 0..9, los displays muestran justo su
// patrón (sin punto decimal), el LFSR no se clavó en 0 y las rondas no repiten el resultado.
module ruleta_tb;

  logic       clk = 0;
  logic       rst;
  logic       pushbutton_frenar;
  logic [7:0] display7_0, display7_1, display7_2, display7_3;

  board dut (.*);

  always #5 clk = ~clk;

  localparam logic [7:0] SEG [10] = '{8'h7E, 8'h30, 8'h6D, 8'h79, 8'h33, 8'h5B, 8'h5F, 8'h70, 8'h7F, 8'h7B};

  // direcciones de palabra en la RAM
  localparam int RES      = 256;  // 0x400
  localparam int RONDAS   = 260;  // 0x410
  localparam int LFSR     = 261;  // 0x414
  localparam int FRENADOS = 262;  // 0x418

  logic [31:0] results [$];

  initial begin
    pushbutton_frenar = 0;
    rst = 1;
    @(posedge clk);
    @(posedge clk);
    #1 rst = 0;

    for (int r = 0; r < 3; r++) begin
      for (int k = 0; k < 4; k++) begin
        repeat (1500 + 700 * k + 1100 * r) @(posedge clk);  // aprieta en momentos distintos
        #1 pushbutton_frenar = 1;
        repeat (3000) @(posedge clk);                       // lo mantiene varios pasos
        #1 pushbutton_frenar = 0;
        if (dut.sys.mem_i.mem[FRENADOS] !== k + 1)
          $fatal(1, "FAIL ruleta: ronda %0d, pulsación %0d: frenados = %0d", r, k,
                 dut.sys.mem_i.mem[FRENADOS]);
        begin
          logic [7:0] d;
          d = dut.sys.mem_i.mem[RES][8*k+:8];
          if (d > 9) $fatal(1, "FAIL ruleta: dígito %0d fuera de rango (%0d)", k, d);
          if ((dut.port_out[8*k+:8] & 8'h7F) !== SEG[d[3:0]])
            $fatal(1, "FAIL ruleta: el display %0d frenó en 0x%02h, esperaba 0x%02h", k,
                   dut.port_out[8*k+:8], SEG[d[3:0]]);
        end
      end

      // espera el fin de la ronda (después de titilar) y mira los displays en ese ciclo
      begin
        int t = 0;
        while (dut.sys.mem_i.mem[RONDAS] !== r + 1) begin
          @(posedge clk);
          #1;
          if (++t > 60000) $fatal(1, "FAIL ruleta: la ronda %0d no terminó", r);
        end
      end
      begin
        logic [31:0] res;
        res = dut.sys.mem_i.mem[RES];
        for (int i = 0; i < 4; i++) begin
          if (res[8*i+:8] > 9) $fatal(1, "FAIL ruleta: dígito %0d fuera de rango (%0d)", i, res[8*i+:8]);
          if (dut.port_out[8*i+:8] !== SEG[res[8*i+:4]])
            $fatal(1, "FAIL ruleta: display %0d = 0x%02h, esperaba 0x%02h", i, dut.port_out[8*i+:8],
                   SEG[res[8*i+:4]]);
        end
        if (dut.sys.mem_i.mem[LFSR] === 32'd0) $fatal(1, "FAIL ruleta: el LFSR quedó en 0");
        results.push_back(res);
      end
    end

    if (results[0] === results[1] && results[1] === results[2]) $fatal(1, "FAIL ruleta: el resultado no cambia");

    $display("ruleta_tb: PASS (3 rondas: %08h %08h %08h)", results[0], results[1], results[2]);
    $finish;
  end

endmodule
