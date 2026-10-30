import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export class CharacterAvatar {
  public readonly root = new THREE.Group();
  private readonly bodyGroup = new THREE.Group();
  private readonly headPivot = new THREE.Group();
  private readonly leftArmPivot = new THREE.Group();
  private readonly rightArmPivot = new THREE.Group();
  private readonly leftLegPivot = new THREE.Group();
  private readonly rightLegPivot = new THREE.Group();
  private readonly heldBrickMesh: THREE.Mesh;

  private walkPhase = 0;
  private climbPhase = 0;
  private swingProgress = 0;
  private isSwinging = false;
  private currentBodyYaw = 0;

  constructor() {
    // Shared PBR Materials for the Architect/Builder Character
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xf4c29f,
      roughness: 0.65,
      metalness: 0.02,
    });
    const hairMat = new THREE.MeshStandardMaterial({
      color: 0x3b281e,
      roughness: 0.8,
    });
    const jacketMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc, // Veste d'architecte blanche / lin clair
      roughness: 0.72,
    });
    const shirtMat = new THREE.MeshStandardMaterial({
      color: 0x334155, // T-shirt gris ardoise sous la veste
      roughness: 0.75,
    });
    const pantsMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a5f, // Jean bleu foncé
      roughness: 0.82,
    });
    const bootsMat = new THREE.MeshStandardMaterial({
      color: 0x5c3a21, // Bottes en cuir brun
      roughness: 0.6,
    });
    const backpackMat = new THREE.MeshStandardMaterial({
      color: 0x854d0e, // Sac à dos d'architecte en cuir camel
      roughness: 0.65,
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });

    // Le personnage mesure ~1.72m au total. Son centre physique est à y=0 (pieds à y = -0.86, sommet tête à y = +0.86)
    this.bodyGroup.position.y = -0.86;
    this.root.add(this.bodyGroup);

    // --- 1. Torse (y = 0.68 .. 1.30 depuis les pieds) ---
    const torsoGeo = new RoundedBoxGeometry(0.46, 0.62, 0.26, 3, 0.04);
    const torsoMesh = new THREE.Mesh(torsoGeo, jacketMat);
    torsoMesh.position.set(0, 0.99, 0);
    this.bodyGroup.add(torsoMesh);

    // Col / T-shirt intérieur sur le devant (-Z est l'avant)
    const shirtStrip = new THREE.Mesh(
      new RoundedBoxGeometry(0.18, 0.56, 0.27, 2, 0.02),
      shirtMat
    );
    shirtStrip.position.set(0, 1.0, -0.005);
    this.bodyGroup.add(shirtStrip);

    // Sac à dos sur le dos (+Z)
    const backpack = new THREE.Mesh(
      new RoundedBoxGeometry(0.34, 0.42, 0.14, 3, 0.03),
      backpackMat
    );
    backpack.position.set(0, 1.01, 0.18);
    this.bodyGroup.add(backpack);

    // --- 2. Tête articulée (Pivot au cou y = 1.30) ---
    this.headPivot.position.set(0, 1.32, 0);
    this.bodyGroup.add(this.headPivot);

    const headGeo = new RoundedBoxGeometry(0.42, 0.42, 0.42, 3, 0.05);
    const headMesh = new THREE.Mesh(headGeo, skinMat);
    headMesh.position.set(0, 0.21, 0);
    this.headPivot.add(headMesh);

    // Cheveux / Coupe moderne
    const hairTop = new THREE.Mesh(
      new RoundedBoxGeometry(0.45, 0.14, 0.45, 3, 0.04),
      hairMat
    );
    hairTop.position.set(0, 0.4, 0);
    this.headPivot.add(hairTop);

    const hairBack = new THREE.Mesh(
      new RoundedBoxGeometry(0.44, 0.32, 0.14, 2, 0.03),
      hairMat
    );
    hairBack.position.set(0, 0.26, 0.16);
    this.headPivot.add(hairBack);

    // Yeux + Sourcils sur la face avant (-Z) pour bien distinguer le visage quand il se tourne
    const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.025), eyeMat);
    leftEye.position.set(-0.095, 0.21, -0.21);
    const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.025), eyeMat);
    rightEye.position.set(0.095, 0.21, -0.21);

    const leftBrow = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.025), hairMat);
    leftBrow.position.set(-0.095, 0.27, -0.21);
    const rightBrow = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.025), hairMat);
    rightBrow.position.set(0.095, 0.27, -0.21);

    this.headPivot.add(leftEye, rightEye, leftBrow, rightBrow);

    // --- 3. Bras Gauche et Bras Droit (Pivots aux épaules y = 1.25) ---
    this.leftArmPivot.position.set(-0.33, 1.25, 0);
    this.rightArmPivot.position.set(0.33, 1.25, 0);
    this.bodyGroup.add(this.leftArmPivot, this.rightArmPivot);

    const armUpperGeo = new RoundedBoxGeometry(0.18, 0.46, 0.18, 3, 0.035);
    const handGeo = new RoundedBoxGeometry(0.15, 0.16, 0.15, 2, 0.03);

    const leftSleeve = new THREE.Mesh(armUpperGeo, jacketMat);
    leftSleeve.position.set(0, -0.2, 0);
    const leftHand = new THREE.Mesh(handGeo, skinMat);
    leftHand.position.set(0, -0.46, 0);
    this.leftArmPivot.add(leftSleeve, leftHand);

    const rightSleeve = new THREE.Mesh(armUpperGeo, jacketMat);
    rightSleeve.position.set(0, -0.2, 0);
    const rightHand = new THREE.Mesh(handGeo, skinMat);
    rightHand.position.set(0, -0.46, 0);
    this.rightArmPivot.add(rightSleeve, rightHand);

    // Petite brique blanche tenue dans la main droite
    this.heldBrickMesh = new THREE.Mesh(
      new RoundedBoxGeometry(0.22, 0.22, 0.22, 2, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })
    );
    this.heldBrickMesh.position.set(0, -0.54, -0.1);
    this.rightArmPivot.add(this.heldBrickMesh);

    // --- 4. Jambe Gauche et Jambe Droite (Pivots aux hanches y = 0.68) ---
    this.leftLegPivot.position.set(-0.12, 0.68, 0);
    this.rightLegPivot.position.set(0.12, 0.68, 0);
    this.bodyGroup.add(this.leftLegPivot, this.rightLegPivot);

    const legGeo = new RoundedBoxGeometry(0.2, 0.54, 0.2, 3, 0.03);
    const bootGeo = new RoundedBoxGeometry(0.21, 0.16, 0.26, 2, 0.03);

    const leftPants = new THREE.Mesh(legGeo, pantsMat);
    leftPants.position.set(0, -0.27, 0);
    const leftBoot = new THREE.Mesh(bootGeo, bootsMat);
    leftBoot.position.set(0, -0.6, -0.02);
    this.leftLegPivot.add(leftPants, leftBoot);

    const rightPants = new THREE.Mesh(legGeo, pantsMat);
    rightPants.position.set(0, -0.27, 0);
    const rightBoot = new THREE.Mesh(bootGeo, bootsMat);
    rightBoot.position.set(0, -0.6, -0.02);
    this.rightLegPivot.add(rightPants, rightBoot);

    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }

  public triggerArmSwing(): void {
    this.isSwinging = true;
    this.swingProgress = 0;
  }

  public update(
    dt: number,
    position: THREE.Vector3,
    isMoving: boolean,
    moveSpeed: number,
    targetFacingYaw: number,
    cameraPitch: number,
    isGrounded: boolean,
    isFlying: boolean,
    visible: boolean,
    isSitting = false,
    isOnLadder = false,
    ladderClimbSpeed = 0
  ): void {
    this.root.visible = visible;
    this.root.position.copy(position);

    // Rotation 360° fluide vers la direction choisie par les flèches directionnelles (Haut, Bas, Gauche, Droite)
    let yawDiff = targetFacingYaw - this.currentBodyYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    this.currentBodyYaw += yawDiff * Math.min(1, dt * 16);
    this.root.rotation.y = this.currentBodyYaw;

    // La tête regarde dans la direction où fait face le personnage
    this.headPivot.rotation.y = 0;
    this.headPivot.rotation.x = THREE.MathUtils.clamp(cameraPitch * 0.45, -0.45, 0.45);

    // Cycle d'animation des jambes et des bras
    if (isSitting) {
      this.leftLegPivot.rotation.x = -Math.PI * 0.48;
      this.rightLegPivot.rotation.x = -Math.PI * 0.48;
      this.leftLegPivot.rotation.z = -0.08;
      this.rightLegPivot.rotation.z = 0.08;
      this.leftArmPivot.rotation.x = -0.25;
      this.rightArmPivot.rotation.x = -0.25;
      this.bodyGroup.position.y = -0.62;
    } else if (isOnLadder) {
      // Escalade réaliste sur échelle
      if (Math.abs(ladderClimbSpeed) > 0.15) {
        this.climbPhase += dt * Math.abs(ladderClimbSpeed) * 4.2;
        const armSwing = Math.sin(this.climbPhase) * 0.48;
        const legSwing = Math.sin(this.climbPhase) * 0.38;
        // Bras levés en avant qui alternent pour attraper les barreaux
        this.leftArmPivot.rotation.x = -Math.PI * 0.45 + armSwing;
        this.rightArmPivot.rotation.x = -Math.PI * 0.45 - armSwing;
        this.leftArmPivot.rotation.z = 0.12;
        this.rightArmPivot.rotation.z = -0.12;
        // Jambes qui montent en rythme
        this.leftLegPivot.rotation.x = -legSwing;
        this.rightLegPivot.rotation.x = legSwing;
        this.leftLegPivot.rotation.z = 0;
        this.rightLegPivot.rotation.z = 0;
        this.bodyGroup.position.y = -0.86 + Math.abs(Math.sin(this.climbPhase * 2)) * 0.028;
      } else {
        // En suspension immobile sur l'échelle : maintien ferme à deux mains aux échelons
        this.leftArmPivot.rotation.x = THREE.MathUtils.lerp(this.leftArmPivot.rotation.x, -Math.PI * 0.42, dt * 10);
        this.rightArmPivot.rotation.x = THREE.MathUtils.lerp(this.rightArmPivot.rotation.x, -Math.PI * 0.42, dt * 10);
        this.leftArmPivot.rotation.z = 0.12;
        this.rightArmPivot.rotation.z = -0.12;
        this.leftLegPivot.rotation.x = THREE.MathUtils.lerp(this.leftLegPivot.rotation.x, -0.16, dt * 10);
        this.rightLegPivot.rotation.x = THREE.MathUtils.lerp(this.rightLegPivot.rotation.x, 0.16, dt * 10);
        this.bodyGroup.position.y = -0.86;
      }
    } else if (isMoving && isGrounded && !isFlying) {
      this.walkPhase += dt * Math.max(4.5, moveSpeed) * 1.65;
      const swing = Math.sin(this.walkPhase) * 0.75;
      this.leftLegPivot.rotation.x = swing;
      this.rightLegPivot.rotation.x = -swing;
      this.leftArmPivot.rotation.x = -swing * 0.85;
      this.rightArmPivot.rotation.x = swing * 0.85;
      this.bodyGroup.position.y = -0.86 + Math.abs(Math.cos(this.walkPhase)) * 0.048;
    } else if (!isGrounded || isFlying) {
      // Pose de saut ou de vol
      this.leftLegPivot.rotation.x = THREE.MathUtils.lerp(this.leftLegPivot.rotation.x, -0.28, dt * 10);
      this.rightLegPivot.rotation.x = THREE.MathUtils.lerp(this.rightLegPivot.rotation.x, 0.22, dt * 10);
      this.leftArmPivot.rotation.x = THREE.MathUtils.lerp(this.leftArmPivot.rotation.x, -0.35, dt * 10);
      this.rightArmPivot.rotation.x = THREE.MathUtils.lerp(this.rightArmPivot.rotation.x, -0.35, dt * 10);
      this.bodyGroup.position.y = -0.86;
    } else {
      // Respiration subtile au repos (Idle)
      this.walkPhase += dt * 2.0;
      const idleBreathe = Math.sin(this.walkPhase) * 0.035;
      this.leftLegPivot.rotation.x = THREE.MathUtils.lerp(this.leftLegPivot.rotation.x, 0, dt * 10);
      this.rightLegPivot.rotation.x = THREE.MathUtils.lerp(this.rightLegPivot.rotation.x, 0, dt * 10);
      this.leftArmPivot.rotation.x = THREE.MathUtils.lerp(this.leftArmPivot.rotation.x, idleBreathe, dt * 10);
      this.rightArmPivot.rotation.x = THREE.MathUtils.lerp(this.rightArmPivot.rotation.x, -idleBreathe, dt * 10);
      this.leftArmPivot.rotation.z = 0.05;
      this.rightArmPivot.rotation.z = -0.05;
      this.bodyGroup.position.y = -0.86;
    }

    // Animation du bras droit lors de la pose ou casse d'une brique
    if (this.isSwinging) {
      this.swingProgress += dt * 5.5;
      if (this.swingProgress >= 1) {
        this.isSwinging = false;
        this.swingProgress = 0;
      } else {
        const armRaise = Math.sin(this.swingProgress * Math.PI) * 1.35;
        this.rightArmPivot.rotation.x = armRaise;
      }
    }
  }
}
