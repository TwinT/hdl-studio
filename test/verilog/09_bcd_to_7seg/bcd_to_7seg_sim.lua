-- Recorre los 16 valores de "digit" (0..9 validos, 10..15 invalidos) y
-- muestra el patron de segmentos resultante: 0..9 deberian dar un patron
-- distinto cada uno, 10..15 deberian mostrar el display apagado (00000000).

print("=== Simulacion: BCD a siete segmentos ===\n");

for digit = 0, 15 do
    sim.setinput("digit", digit);
    sim.sleep(20);
    print(string.format("digit=%2d -> display7=%s\n",
        digit, sim.getoutput("display7"):tobin()));
end
