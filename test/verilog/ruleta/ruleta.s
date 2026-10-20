# ruleta.s -- una tragamonedas de 4 dígitos en displays de 7 segmentos, con un botón para frenar.
#
# Los cuatro dígitos giran (un segmento recorre el anillo exterior). Cada vez que se aprieta el
# pulsador (bit 0 de PORT_IN) frena el próximo, de izquierda a derecha, en un dígito que sale de un
# LFSR de 16 bits (xorshift 7,9,8: solo desplazamientos y xor). El LFSR avanza en cada paso del
# giro, así que el resultado depende de cuándo se aprieta. Cuando frena el cuarto, el punto decimal
# titila 3 veces y vuelve a girar todo. Cada byte de PORT_OUT es un display {dp,a,b,c,d,e,f,g}.

    .section .text.start,"ax",@progbits
    .global _start

    .equ  PAUSA,    30       # vueltas de la pausa entre pasos del giro
    .equ  RES,      0x400    # RES[0..3]: dígitos sorteados (los lee el testbench)
    .equ  RONDAS,   0x410    # rondas completas
    .equ  LFSR,     0x414    # estado del LFSR al terminar la ronda
    .equ  FRENADOS, 0x418    # dígitos ya frenados en esta ronda

_start:
    lui   s10, 0x20          # s10 = PORT_IN
    addi  s0, s10, 4         # s0 = PORT_OUT
    la    s1, digitos        # patrones de 0 a 9
    la    s2, anillo         # los 6 segmentos del anillo
    li    s3, 0xACE1         # estado del LFSR (no puede ser 0)
    li    s4, 0              # posición del anillo
    lui   s11, 0x10
    addi  s11, s11, -1       # s11 = 0xFFFF
    li    s9, 0              # el pulsador en el paso anterior

ronda:
    li    s5, 0              # s5 = dígitos ya frenados
    sw    s5, FRENADOS(zero)

giro:
    mv    t0, s5             # dibuja los que giran, cada uno desfasado en el anillo
dibuja:
    add   t1, s4, t0
    li    t2, 6
    blt   t1, t2, sin_vuelta
    addi  t1, t1, -6
sin_vuelta:
    add   t1, t1, s2
    lbu   t1, 0(t1)
    add   t3, s0, t0
    sb    t1, 0(t3)
    addi  t0, t0, 1
    li    t2, 4
    bne   t0, t2, dibuja

    li    t0, PAUSA          # pausa
pausa:
    addi  t0, t0, -1
    bne   t0, zero, pausa

    addi  s4, s4, 1          # el anillo avanza un segmento
    li    t2, 6
    bne   s4, t2, sigue
    li    s4, 0
sigue:
    slli  t0, s3, 7          # xorshift16: x ^= x << 7; x ^= x >> 9; x ^= x << 8
    xor   s3, s3, t0
    and   s3, s3, s11
    srli  t0, s3, 9
    xor   s3, s3, t0
    slli  t0, s3, 8
    xor   s3, s3, t0
    and   s3, s3, s11

    lw    t0, 0(s10)         # el pulsador: frena solo en el flanco, de suelto a apretado
    andi  t0, t0, 1
    mv    t1, s9
    mv    s9, t0
    beq   t0, zero, giro     # suelto: sigue girando
    bne   t1, zero, giro     # ya estaba apretado: no es un flanco

    # --- flanco: el dígito s5 frena en el que marca el LFSR ---
    andi  t0, s3, 0xFF       # d = (v * 10) >> 8: un dígito de 0 a 9 sin dividir
    slli  t1, t0, 3
    slli  t2, t0, 1
    add   t1, t1, t2
    srli  t1, t1, 8
    sb    t1, RES(s5)        # s5 es el índice: RES + s5 (el ensamblador suma)
    add   t1, t1, s1
    lbu   t1, 0(t1)
    add   t3, s0, s5
    sb    t1, 0(t3)          # el dígito queda fijo
    addi  s5, s5, 1
    sw    s5, FRENADOS(zero)
    li    t0, 4
    bne   s5, t0, giro

    # --- ronda completa: el punto decimal titila 3 veces (relee PORT_OUT y cambia un bit) ---
    li    s8, 3
titila:
    lw    t0, 0(s0)
    li    t1, 0x80808080
    or    t0, t0, t1
    sw    t0, 0(s0)          # los cuatro puntos prendidos
    li    t2, 400
dp_on:
    addi  t2, t2, -1
    bne   t2, zero, dp_on
    lw    t0, 0(s0)
    li    t1, 0x7F7F7F7F
    and   t0, t0, t1
    sw    t0, 0(s0)          # apagados
    li    t2, 400
dp_off:
    addi  t2, t2, -1
    bne   t2, zero, dp_off
    addi  s8, s8, -1
    bne   s8, zero, titila

    sw    s3, LFSR(zero)     # primero el estado y después el aviso de que la ronda terminó
    lw    t0, RONDAS(zero)
    addi  t0, t0, 1
    sw    t0, RONDAS(zero)
    j     ronda

    .section .rodata
digitos:                     # {dp,a,b,c,d,e,f,g}
    .byte 0x7E, 0x30, 0x6D, 0x79, 0x33, 0x5B, 0x5F, 0x70, 0x7F, 0x7B
anillo:                      # a, b, c, d, e, f
    .byte 0x40, 0x20, 0x10, 0x08, 0x04, 0x02
